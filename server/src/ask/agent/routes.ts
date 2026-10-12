import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { applyProposal, type Decided, rejectProposal, revertProposal } from "./apply.js";
import { listProposals, PROPOSAL_STATUSES } from "./proposals.js";
import { CONTENT_GOALS, readTargets, targetKey } from "./targets.js";

/**
 * The content agent's proposals, under /admin/assistant/proposals (the admin
 * router's auth and CSRF apply; plan phases 29–30): the list, newest first,
 * and the admin's decisions on them (apply.ts). Applying writes the draft
 * content, never the live site; publishing stays in Review & publish.
 */
export const proposalsRouter = new Hono();

const invalid = (result: { success: boolean }, c: Context) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "not_found" }, 404),
);

/** The admin deciding: the session's user, who `saveSection` records as the editor. */
const adminOf = (c: Context): string => c.get("session").userId;

/** The proposals listed at most, newest first: the page filters by status on the server. */
const LISTED = 200;

/** `status=proposed,needs_you`: one or more statuses. */
const statuses = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(z.enum(PROPOSAL_STATUSES)).min(1).max(PROPOSAL_STATUSES.length));

proposalsRouter.get(
  "/",
  zValidator("query", z.object({ run: z.uuid().optional(), status: statuses.optional() }), invalid),
  async (c) => {
    const { run, status } = c.req.valid("query");
    const proposals = await listProposals({ runId: run, statuses: status }, LISTED);
    // An open one whose field moved on since its draft: applying it would turn it stale.
    const open = proposals.filter((p) => p.status === "proposed" || p.status === "needs_you");
    const now = await readTargets(
      open.map((p) => targetKey(p)),
      CONTENT_GOALS,
    );
    return c.json({
      proposals: proposals.map((p) => {
        if (p.status !== "proposed" && p.status !== "needs_you") return { ...p, changed: false };
        const target = now.get(targetKey(p));
        return { ...p, changed: target?.current !== p.before };
      }),
      // More than these: the oldest are not listed.
      limited: proposals.length === LISTED,
    });
  },
);

function answer(c: Context, result: Decided): Response {
  if (result.ok) return c.json({ proposal: result.proposal });
  if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.error === "invalid_input") {
    return c.json({ error: "invalid_input", issues: result.issues }, 400);
  }
  return c.json({ error: result.error }, 409);
}

/**
 * `run` over `items` strictly one after another, results in the items' order. Each
 * call starts only when the one before has settled: the decisions are transactions on
 * shared content, so they must not overlap.
 */
async function inOrder<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  await items.reduce(async (previous, item) => {
    await previous;
    results.push(await run(item));
  }, Promise.resolve());
  return results;
}

/** The admin's own text for a field: something to write, never a blank. */
const ownText = z
  .string()
  .max(200_000)
  .refine((text) => text.trim() !== "", "empty");

proposalsRouter.post(
  "/:id/apply",
  idParam,
  zValidator("json", z.object({ text: ownText.optional() }), invalid),
  async (c) =>
    answer(c, await applyProposal(c.req.valid("param").id, adminOf(c), c.req.valid("json").text)),
);

proposalsRouter.post("/:id/reject", idParam, async (c) =>
  answer(c, await rejectProposal(c.req.valid("param").id)),
);

proposalsRouter.post("/:id/revert", idParam, async (c) =>
  answer(c, await revertProposal(c.req.valid("param").id, adminOf(c))),
);

/** Several at once, each in its own transaction: a result per id, in their order. */
proposalsRouter.post(
  "/decide",
  zValidator(
    "json",
    z.object({
      ids: z
        .array(z.uuid())
        .min(1)
        .max(100)
        .refine((ids) => new Set(ids).size === ids.length, "each id once"),
      action: z.enum(["apply", "reject"]),
    }),
    invalid,
  ),
  async (c) => {
    const { ids, action } = c.req.valid("json");
    const admin = adminOf(c);
    const decide = async (id: string) => {
      // One failing (its transaction rolled back) says so, and the others are still decided:
      // the answer names each id's fate, those committed before it included.
      try {
        const result =
          action === "apply" ? await applyProposal(id, admin) : await rejectProposal(id);
        return result.ok ? { id, proposal: result.proposal } : { id, error: result.error };
      } catch (error) {
        console.error("[agent] a proposal's decision failed", error);
        return { id, error: "failed" };
      }
    };
    return c.json({ results: await inOrder(ids, decide) });
  },
);
