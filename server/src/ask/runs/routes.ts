import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { askConfig, askVariantChain, askVisitorJudges } from "../deps.js";
import { EVAL_CASES } from "../evals/cases.js";
import { spendBlocked } from "./budget.js";
import { evalWork } from "./eval-work.js";
import { judgeWork, reviewedToJudge } from "./judge-work.js";
import { pairwiseWork } from "./pairwise-work.js";
import {
  cancelRun,
  registerWork,
  resumeRun,
  runInFlight,
  startRun,
  whileStarting,
} from "./runner.js";
import { activeRuns, getRun, listRuns, type RunKind, type RunRow } from "./store.js";

/**
 * The admin's background runs, under /admin/assistant/runs (the admin
 * router's auth and CSRF apply): start one, follow it, cancel it, resume it.
 * Kinds: the eval suite, a pairwise comparison of two answerers, and judging
 * the reviewed visitor answers (for the judge's calibration).
 */

registerWork("eval", evalWork);
registerWork("pairwise", pairwiseWork);
registerWork("judge", judgeWork);

export const runsRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

/** A run, and whether a worker in this API process is on it now. */
const view = (run: RunRow) => ({ ...run, live: runInFlight(run.id) });

const cases = z.array(z.string().max(40)).max(60).optional();
/** A pairwise side: a route (`lite`, `deep`) or a model id. */
const answerer = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][\w.:/-]{0,99}$/);

const runInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eval"), cases }),
  z.object({ kind: z.literal("pairwise"), a: answerer, b: answerer, cases }),
  z.object({ kind: z.literal("judge") }),
]);

type Refusal = { error: string; status: 400 | 409 | 503 };

/** What a new run of this kind works through, and with what; or why it cannot start. */
async function planRun(
  input: z.infer<typeof runInput>,
): Promise<{ params: Record<string, unknown>; keys: string[] } | Refusal> {
  if (input.kind === "judge") {
    const judge = askVisitorJudges(askConfig())[0]?.id;
    if (!judge) return { error: "no_visitor_judge", status: 400 };
    const keys = await reviewedToJudge(judge);
    if (!keys.length) return { error: "nothing_to_judge", status: 400 };
    return { params: { judge }, keys };
  }
  const chosen = input.cases?.length
    ? EVAL_CASES.filter((e) => input.cases!.includes(e.id))
    : EVAL_CASES;
  if (!chosen.length) return { error: "no_cases", status: 400 };
  const keys = chosen.map((e) => e.id);
  if (input.kind === "eval") return { params: { cases: input.cases ?? null }, keys };
  if (input.a === input.b) return { error: "same_answerer", status: 400 };
  for (const side of [input.a, input.b]) {
    if (!askVariantChain(askConfig(), side)?.length) {
      return { error: "unknown_answerer", status: 400 };
    }
  }
  return { params: { a: input.a, b: input.b, cases: input.cases ?? null }, keys };
}

runsRouter.post("/", zValidator("json", runInput, invalid), async (c) => {
  const input = c.req.valid("json");
  const plan = await planRun(input);
  if ("error" in plan) return c.json({ error: plan.error }, plan.status);
  const started = await whileStarting(async (): Promise<{ id: string } | Refusal> => {
    // One paid run at a time, whatever its kind: they share the providers' quota.
    if ((await activeRuns()).length) return { error: "already_running", status: 409 };
    const blocked = await spendBlocked(input.kind);
    if (blocked) return { error: blocked, status: 503 };
    const run = await startRun(input.kind, plan.params, plan.keys);
    return run ? { id: run.id } : { error: "already_running", status: 409 };
  });
  if (started === "busy") return c.json({ error: "already_running" }, 409);
  if ("error" in started) return c.json({ error: started.error }, started.status);
  return c.json({ id: started.id }, 202);
});

runsRouter.get("/", async (c) => c.json({ runs: (await listRuns()).map(view) }));

runsRouter.get("/:id", idParam, async (c) => {
  const found = await getRun(c.req.valid("param").id);
  if (!found) return c.json({ error: "not_found" }, 404);
  return c.json({ run: view(found.run), items: found.items });
});

runsRouter.post("/:id/cancel", idParam, async (c) => {
  const found = await getRun(c.req.valid("param").id);
  if (!found) return c.json({ error: "not_found" }, 404);
  if (!(await cancelRun(found.run.id, found.run.status))) {
    return c.json({ error: "not_cancellable" }, 409);
  }
  return c.json({ ok: true });
});

runsRouter.post("/:id/resume", idParam, async (c) => {
  const resumed = await whileStarting(async (): Promise<{ id: string } | Refusal> => {
    if ((await activeRuns()).length) return { error: "already_running", status: 409 };
    const found = await getRun(c.req.valid("param").id);
    if (!found) return { error: "not_resumable", status: 409 };
    const blocked = await spendBlocked(found.run.kind as RunKind);
    if (blocked) return { error: blocked, status: 503 };
    const run = await resumeRun(found.run.id);
    return run ? { id: run.id } : { error: "not_resumable", status: 409 };
  });
  if (resumed === "busy") return c.json({ error: "already_running" }, 409);
  if ("error" in resumed) return c.json({ error: resumed.error }, resumed.status);
  return c.json({ id: resumed.id }, 202);
});
