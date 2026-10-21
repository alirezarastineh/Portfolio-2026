import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiEvalCases } from "../db/schema.js";
import { askConfig, askCorpus } from "./deps.js";
import {
  earlierQuestions,
  freezeCase,
  MAX_FROZEN_TURNS,
  snapshotCorpora,
  staleness,
} from "./evals/production.js";
import { ASK_MESSAGE_ID } from "./history.js";

/**
 * The production eval cases (evals/production.ts), under
 * /admin/assistant/eval-cases (the admin router's auth and CSRF apply): the
 * list with each case's staleness against the live corpus, freezing a
 * visitor's answer into a case (its questions rewritten by the admin to
 * remove anything personal), retiring one, and deleting one for good.
 */
export const evalCasesRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

evalCasesRouter.get("/", async (c) => {
  const rows = await getDb().select().from(aiEvalCases).orderBy(desc(aiEvalCases.createdAt));
  const [live, snapshots] = await Promise.all([
    askCorpus(askConfig()),
    snapshotCorpora(rows.map((row) => row.snapshotKey)),
  ]);
  return c.json({
    cases: rows.map((row) => {
      const snapshot = snapshots.get(row.snapshotKey);
      const cited = [...row.mustCite, ...row.citeAny];
      return {
        id: row.id,
        question: row.question,
        turns: row.turns?.map((turn) => turn.question) ?? [],
        locale: row.locale,
        snapshotKey: row.snapshotKey,
        mustCite: row.mustCite,
        mustInclude: row.mustInclude,
        status: row.status,
        fromMessageId: row.fromMessageId,
        createdAt: row.createdAt,
        stale: snapshot ? staleness(cited, snapshot, live) : "gone",
      };
    }),
  });
});

/** A case pattern is a case-insensitive regular expression, as the graders read it. */
function isPattern(text: string): boolean {
  try {
    new RegExp(text, "i");
    return true;
  } catch {
    return false;
  }
}

/** A visitor's question as a case keeps it: as long as one the terminal takes. */
const keptQuestion = z.string().trim().min(3).max(600);

const freezeInput = z.object({
  messageId: z.string().regex(ASK_MESSAGE_ID),
  /** The question rewritten to remove anything personal (the case is kept until deleted). */
  question: keptQuestion.optional(),
  /** The session's earlier questions, oldest first, each rewritten the same way. */
  turns: z.array(keptQuestion).max(MAX_FROZEN_TURNS).optional(),
  mustCite: z.array(z.string().trim().min(1).max(160)).max(10).optional(),
  mustInclude: z.array(z.string().trim().min(1).max(200).refine(isPattern)).max(10).optional(),
  /**
   * The admin's word that the questions, as they will be kept, hold nothing
   * personal: no case is frozen without it (the privacy text says so).
   */
  personalChecked: z.literal(true),
});

evalCasesRouter.post("/", zValidator("json", freezeInput, invalid), async (c) => {
  const { messageId, question, turns, mustCite, mustInclude } = c.req.valid("json");
  const result = await freezeCase(messageId, { question, turns, mustCite, mustInclude });
  if (!result.ok) return c.json({ error: result.error }, result.error === "not_found" ? 404 : 409);
  return c.json({ id: result.id }, 201);
});

/** What the freeze form offers as earlier turns: the questions before the answer, in its session. */
evalCasesRouter.get(
  "/earlier/:messageId",
  zValidator("param", z.object({ messageId: z.string().regex(ASK_MESSAGE_ID) }), (result, c) =>
    result.success ? undefined : c.json({ error: "invalid_id" }, 400),
  ),
  async (c) => {
    const questions = await earlierQuestions(c.req.valid("param").messageId);
    if (!questions) return c.json({ error: "not_found" }, 404);
    return c.json({ questions });
  },
);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

/** Deleted for good, its question with it; its snapshot is then pruned once unreferenced. */
evalCasesRouter.delete("/:id", idParam, async (c) => {
  const [row] = await getDb()
    .delete(aiEvalCases)
    .where(eq(aiEvalCases.id, c.req.valid("param").id))
    .returning({ id: aiEvalCases.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

evalCasesRouter.patch(
  "/:id",
  idParam,
  zValidator("json", z.object({ status: z.enum(["active", "retired"]) }), invalid),
  async (c) => {
    const [row] = await getDb()
      .update(aiEvalCases)
      .set({ status: c.req.valid("json").status, updatedAt: new Date() })
      .where(eq(aiEvalCases.id, c.req.valid("param").id))
      .returning({ id: aiEvalCases.id });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  },
);
