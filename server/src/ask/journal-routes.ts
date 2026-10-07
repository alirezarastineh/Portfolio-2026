import { zValidator } from "@hono/zod-validator";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiEvalCases, aiJournal } from "../db/schema.js";
import { ASK_MESSAGE_ID } from "./history.js";
import {
  createEntry,
  entryFor,
  getEntry,
  loadAnswer,
  loadCorpora,
  namedIn,
  namesKnownDocument,
  reanalysed,
  views,
} from "./journal-store.js";
import {
  decisionProblem,
  diagnose,
  FIX_TYPES,
  JOURNAL_STATUSES,
  TRANSITIONS,
  type JournalStatus,
} from "./journal.js";

/**
 * The failure journal (plan phase 24), under /admin/assistant/journal (the
 * admin router's auth and CSRF apply): the entries, Diagnose on a visitor's
 * answer (no model: journal.ts), and the admin's decisions: edit, accept,
 * link the fix and a regression case, mark it fixed, retire, delete. A
 * replay is a background run (`POST /admin/assistant/runs`, kind `agent`).
 */
export const journalRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

/** The entries shown at most, newest first. */
const LISTED = 200;

journalRouter.get(
  "/",
  zValidator("query", z.object({ status: z.enum(JOURNAL_STATUSES).optional() }), invalid),
  async (c) => {
    const { status } = c.req.valid("query");
    const db = getDb();
    const rows = await db
      .select()
      .from(aiJournal)
      .where(status ? eq(aiJournal.status, status) : undefined)
      .orderBy(desc(aiJournal.createdAt))
      .limit(LISTED);
    const counted = await db
      .select({ status: aiJournal.status, n: sql<number>`count(*)::int` })
      .from(aiJournal)
      .groupBy(aiJournal.status);
    const counts = Object.fromEntries(JOURNAL_STATUSES.map((s) => [s, 0])) as Record<
      JournalStatus,
      number
    >;
    for (const row of counted) counts[row.status] = row.n;
    return c.json({ entries: await views(rows), counts });
  },
);

const diagnoseInput = z.object({
  messageId: z.string().regex(ASK_MESSAGE_ID),
  /** The document that holds the answer, as the admin knows it; null forgets an earlier one. */
  expected: z.string().trim().min(1).max(160).nullable().optional(),
});

/**
 * Diagnose a visitor's answer: a new proposed entry, or the proposed entry
 * for it analysed again (the admin's edits kept). An entry the admin already
 * decided on is not touched (409, with its id).
 */
journalRouter.post("/diagnose", zValidator("json", diagnoseInput, invalid), async (c) => {
  const { messageId, expected } = c.req.valid("json");
  const answer = await loadAnswer(messageId);
  if (!answer) return c.json({ error: "not_found" }, 404);
  const existing = await entryFor(messageId);
  if (existing && existing.status !== "proposed") {
    return c.json({ error: "already_journaled", detail: { id: existing.id } }, 409);
  }
  const corpora = await loadCorpora(answer);
  if (!corpora.snapshot && !corpora.live) return c.json({ error: "corpus_unavailable" }, 503);
  const existingNamed = existing ? namedIn(existing.diagnosis) : null;
  const named = expected === undefined ? existingNamed : expected;
  if (named && !namesKnownDocument(corpora, answer, named)) {
    return c.json({ error: "unknown_document" }, 400);
  }
  const diagnosis = diagnose({ answer, ...corpora, expected: named, replay: existing?.replay });
  const entry = existing
    ? await reanalysed(existing, diagnosis)
    : await createEntry(messageId, diagnosis);
  // Decided by the admin in between: it is theirs now.
  if (!entry) return c.json({ error: "already_journaled", detail: { id: existing!.id } }, 409);
  const [view] = await views([entry]);
  return c.json({ entry: view }, existing ? 200 : 201);
});

const text = (max: number) => z.string().trim().max(max);
const patchInput = z.object({
  status: z.enum(JOURNAL_STATUSES).optional(),
  rootCause: text(2_000).optional(),
  fixType: z.enum(FIX_TYPES).nullable().optional(),
  fix: text(2_000).optional(),
  /** A FAQ id, a prompt version, a document id, a model, a setting. */
  fixRef: text(200).nullable().optional(),
  caseId: z.uuid().nullable().optional(),
  heuristic: text(1_000).optional(),
});

/**
 * The admin's edits and decisions. A status moves only along the
 * transitions (journal.ts `TRANSITIONS`); an entry that stands as accepted
 * or fixed must keep a root cause, a heuristic that says something, and,
 * fixed, its fix.
 */
journalRouter.patch("/:id", idParam, zValidator("json", patchInput, invalid), async (c) => {
  const patch = c.req.valid("json");
  const row = await getEntry(c.req.valid("param").id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const status = patch.status ?? row.status;
  if (status !== row.status && !TRANSITIONS[row.status].includes(status)) {
    return c.json({ error: "bad_transition" }, 409);
  }
  if (patch.caseId) {
    const [found] = await getDb()
      .select({ id: aiEvalCases.id })
      .from(aiEvalCases)
      .where(eq(aiEvalCases.id, patch.caseId));
    if (!found) return c.json({ error: "unknown_case" }, 400);
  }
  const fields = {
    rootCause: patch.rootCause ?? row.rootCause,
    heuristic: patch.heuristic ?? row.heuristic,
    fixType: patch.fixType === undefined ? row.fixType : patch.fixType,
    fixRef: patch.fixRef === undefined ? row.fixRef : patch.fixRef || null,
    caseId: patch.caseId === undefined ? row.caseId : patch.caseId,
  };
  const problem = decisionProblem(status, fields);
  if (problem) return c.json({ error: problem }, 400);

  const now = new Date();
  const statusChange =
    status === "proposed"
      ? { decidedBy: null, decidedAt: null }
      : { decidedBy: "admin", decidedAt: now };
  const decision = status === row.status ? {} : statusChange;
  const [updated] = await getDb()
    .update(aiJournal)
    .set({
      ...fields,
      ...(patch.fix === undefined ? {} : { fix: patch.fix }),
      status,
      ...decision,
      updatedAt: now,
    })
    .where(eq(aiJournal.id, row.id))
    .returning();
  const [view] = await views([updated!]);
  return c.json({ entry: view });
});

/** Gone for good. */
journalRouter.delete("/:id", idParam, async (c) => {
  const [row] = await getDb()
    .delete(aiJournal)
    .where(eq(aiJournal.id, c.req.valid("param").id))
    .returning({ id: aiJournal.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
