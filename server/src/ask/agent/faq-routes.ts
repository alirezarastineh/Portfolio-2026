import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { draftFaqProposal } from "./faq-chain.js";
import {
  acceptFaqProposal,
  acceptInput,
  FAQ_PROPOSAL_STATUSES,
  type FaqDecision,
  listFaqProposals,
  rejectFaqProposal,
} from "./faq-decide.js";

/**
 * The FAQ pipeline's proposals (plan phase 31), under
 * /admin/assistant/faq-proposals (the admin router's auth and CSRF apply):
 * the list, a draft from an insight topic or a journal entry (paid: the
 * chain, fenced as `agent`), and the admin's decisions. Nothing reaches the
 * FAQ until the admin accepts a proposal.
 */
export const faqProposalsRouter = new Hono();

const invalid = (result: { success: boolean }, c: Context) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "not_found" }, 404),
);

/** The proposals listed at most, newest first. */
const LISTED = 200;

/** `status=proposed,needs_you`: one or more statuses. */
const statuses = z
  .string()
  .transform((s) => s.split(","))
  .pipe(z.array(z.enum(FAQ_PROPOSAL_STATUSES)).min(1).max(FAQ_PROPOSAL_STATUSES.length));

faqProposalsRouter.get(
  "/",
  zValidator("query", z.object({ status: statuses.optional() }), invalid),
  async (c) => {
    // One past the page tells whether there are more.
    const listed = await listFaqProposals(c.req.valid("query").status ?? [], LISTED + 1);
    return c.json({ proposals: listed.slice(0, LISTED), limited: listed.length > LISTED });
  },
);

const sourceInput = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("insight"),
    snapshotId: z.uuid(),
    // An insights run has at most 12 topics.
    topic: z.number().int().min(0).max(20),
  }),
  z.strictObject({ source: z.literal("journal"), entryId: z.uuid() }),
]);

/** Drafts a proposal for the source (201), or returns its open one without a model call (200). */
faqProposalsRouter.post("/", zValidator("json", sourceInput, invalid), async (c) => {
  const outcome = await draftFaqProposal(c.req.valid("json"));
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
  return outcome.existing
    ? c.json({ proposal: outcome.proposal, existing: true })
    : c.json({ proposal: outcome.proposal }, 201);
});

function answer(c: Context, decision: FaqDecision): Response {
  if (decision.ok) return c.json({ proposal: decision.proposal, linked: decision.linked });
  if (decision.error === "not_corroborated") {
    return c.json({ error: decision.error, detail: { reason: decision.reason } }, 400);
  }
  if (decision.error === "instruction") {
    return c.json({ error: decision.error, detail: { locale: decision.locale } }, 400);
  }
  return c.json({ error: decision.error }, decision.status);
}

faqProposalsRouter.post(
  "/:id/accept",
  idParam,
  zValidator("json", acceptInput, invalid),
  async (c) => answer(c, await acceptFaqProposal(c.req.valid("param").id, c.req.valid("json"))),
);

faqProposalsRouter.post("/:id/reject", idParam, async (c) =>
  answer(c, await rejectFaqProposal(c.req.valid("param").id)),
);
