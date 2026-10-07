import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { aiFeedback, aiInsightSnapshots, aiJournal, aiLessons, aiMessages } from "../db/schema.js";
import { HEURISTIC_MIN_WORDS } from "./journal.js";
import {
  cleanScope,
  corroborationProblem,
  LESSON_RULES,
  lessonEffect,
  type LessonEffect,
  type LessonSource,
} from "./lessons.js";
import { OUTCOME_COLUMNS } from "./outcome-rows.js";

/**
 * Lessons (plan phase 25), under /admin/assistant/lessons (the admin router's
 * auth and CSRF apply): the failure journal's top tier. A lesson is the
 * admin's words, corroborated before it is kept (three decided journal
 * entries, or an unanswered insight topic of five questions); applied as a
 * fix (an FAQ entry, a content change, a prompt rule through the eval gate,
 * an eval case); measured on the visitors' answers since, live here and
 * nightly (learning-monitor.ts, which retires one below the floor). Lessons
 * never reach the prompt or a visitor's answer.
 */
export const lessonsRouter = new Hono();

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) =>
  result.success ? undefined : c.json({ error: "invalid_input" }, 400);

const idParam = zValidator("param", z.object({ id: z.uuid() }), (result, c) =>
  result.success ? undefined : c.json({ error: "invalid_id" }, 400),
);

export const LESSON_STATUSES = ["proposed", "active", "retired"] as const;
export const APPLIED_AS = ["faq", "content-task", "prompt-rule", "eval-case"] as const;

type LessonRow = typeof aiLessons.$inferSelect;

/** The lessons shown at most, newest first. */
const LISTED = 200;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Each applied lesson's effect, computed now from the answers kept. */
async function withEffects(
  rows: readonly LessonRow[],
): Promise<(LessonRow & { effect: LessonEffect | null })[]> {
  const applied = rows.filter((r) => r.appliedAt);
  const answers = applied.length
    ? await getDb()
        .select(OUTCOME_COLUMNS)
        .from(aiMessages)
        .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
        .where(eq(aiMessages.source, "terminal"))
    : [];
  const now = new Date();
  return rows.map((row) => ({
    ...row,
    effect: row.appliedAt
      ? lessonEffect(answers, row.scope, row.appliedAt, now, row.reopenedAt)
      : null,
  }));
}

lessonsRouter.get("/", async (c) => {
  const db = getDb();
  const rows = await db.select().from(aiLessons).orderBy(desc(aiLessons.createdAt)).limit(LISTED);
  const counted = await db
    .select({ status: aiLessons.status, n: sql<number>`count(*)::int` })
    .from(aiLessons)
    .groupBy(aiLessons.status);
  const counts = Object.fromEntries(LESSON_STATUSES.map((s) => [s, 0])) as Record<
    (typeof LESSON_STATUSES)[number],
    number
  >;
  for (const row of counted) counts[row.status as keyof typeof counts] = row.n;
  return c.json({ lessons: await withEffects(rows), counts });
});

const statement = z.string().trim().min(1).max(500);
const scope = z.array(z.string().max(60)).min(1).max(40);
const createInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("journal"),
    statement,
    scope,
    journalIds: z.array(z.uuid()).min(1).max(LESSON_RULES.maxEntries),
  }),
  z.object({
    source: z.literal("insight"),
    statement,
    scope,
    snapshotId: z.uuid(),
    topic: z.number().int().min(0).max(20),
  }),
]);

/** A lesson, kept only once corroborated: its words the admin's, its scope clean. */
lessonsRouter.post("/", zValidator("json", createInput, invalid), async (c) => {
  const input = c.req.valid("json");
  if (words(input.statement) < HEURISTIC_MIN_WORDS) {
    return c.json({ error: "vague_statement" }, 400);
  }
  const cleaned = cleanScope(input.scope);
  if (!cleaned.length) return c.json({ error: "empty_scope" }, 400);
  const db = getDb();

  let source: LessonSource;
  let provenance: Pick<typeof aiLessons.$inferInsert, "journalIds" | "topic">;
  if (input.source === "journal") {
    const ids = [...new Set(input.journalIds)];
    const entries = await db
      .select({ id: aiJournal.id, status: aiJournal.status })
      .from(aiJournal)
      .where(inArray(aiJournal.id, ids));
    if (entries.length < ids.length) return c.json({ error: "unknown_entry" }, 400);
    source = { source: "journal", entries };
    provenance = { journalIds: ids, topic: null };
  } else {
    const [snapshot] = await db
      .select({ id: aiInsightSnapshots.id, topics: aiInsightSnapshots.topics })
      .from(aiInsightSnapshots)
      .where(eq(aiInsightSnapshots.id, input.snapshotId));
    const topic = snapshot?.topics[input.topic];
    if (!snapshot || !topic) return c.json({ error: "unknown_topic" }, 400);
    source = { source: "insight", topic };
    // The topic's name and counts, not its example questions (visitor text, pruned with the run).
    provenance = {
      journalIds: [],
      topic: {
        snapshotId: snapshot.id,
        title: topic.title,
        questions: topic.questions,
        unanswered: topic.unanswered,
      },
    };
  }
  const problem = corroborationProblem(source);
  if (problem) return c.json({ error: "not_corroborated", detail: { reason: problem } }, 400);

  const [row] = await db
    .insert(aiLessons)
    .values({ statement: input.statement, scope: cleaned, source: input.source, ...provenance })
    .returning();
  const [view] = await withEffects([row!]);
  return c.json({ lesson: view }, 201);
});

const patchInput = z
  .object({
    statement: statement.optional(),
    scope: scope.optional(),
    /** The fix that applies it: what it is, and where. Measured from now. */
    apply: z.object({ as: z.enum(APPLIED_AS), ref: z.string().trim().min(1).max(200) }).optional(),
    retire: z.literal(true).optional(),
    reopen: z.literal(true).optional(),
  })
  .refine((p) => [p.apply, p.retire, p.reopen].filter(Boolean).length <= 1);

/** The columns a decision sets. */
function decisionOf(
  input: z.infer<typeof patchInput>,
  row: LessonRow,
  now: Date,
): Partial<typeof aiLessons.$inferInsert> {
  if (input.apply) {
    // Measured from this fix on: a reopening before it no longer matters.
    return {
      appliedAs: input.apply.as,
      appliedRef: input.apply.ref,
      appliedAt: now,
      reopenedAt: null,
      status: "active",
    };
  }
  if (input.retire) {
    return {
      status: "retired",
      retiredReason: "retired by the admin",
      decidedBy: "admin",
      decidedAt: now,
    };
  }
  if (input.reopen) {
    // Measured again from now: the answers that retired it do not retire it again.
    return {
      status: row.appliedAt ? "active" : "proposed",
      reopenedAt: row.appliedAt ? now : null,
      retiredReason: null,
      decidedBy: null,
      decidedAt: null,
    };
  }
  return {};
}

/**
 * The admin's edits and decisions: apply (from proposed or active; its
 * measure starts again), retire (from proposed or active), reopen (a retired
 * lesson goes back to active, measured again from now, when it was applied;
 * else to proposed). The row is locked while it is decided, as the nightly
 * check locks it while it measures: neither writes over the other.
 */
lessonsRouter.patch("/:id", idParam, zValidator("json", patchInput, invalid), async (c) => {
  const input = c.req.valid("json");
  if (input.statement !== undefined && words(input.statement) < HEURISTIC_MIN_WORDS) {
    return c.json({ error: "vague_statement" }, 400);
  }
  const cleaned = input.scope === undefined ? undefined : cleanScope(input.scope);
  if (cleaned !== undefined && !cleaned.length) return c.json({ error: "empty_scope" }, 400);

  const outcome = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(aiLessons)
      .where(eq(aiLessons.id, c.req.valid("param").id))
      .for("update");
    if (!row) return "not_found" as const;
    const retired = row.status === "retired";
    if ((input.apply || input.retire) && retired) return "bad_transition" as const;
    if (input.reopen && !retired) return "bad_transition" as const;
    const now = new Date();
    const [updated] = await tx
      .update(aiLessons)
      .set({
        ...(input.statement === undefined ? {} : { statement: input.statement }),
        ...(cleaned === undefined ? {} : { scope: cleaned }),
        ...decisionOf(input, row, now),
        updatedAt: now,
      })
      .where(eq(aiLessons.id, row.id))
      .returning();
    return updated!;
  });
  if (outcome === "not_found") return c.json({ error: "not_found" }, 404);
  if (outcome === "bad_transition") return c.json({ error: "bad_transition" }, 409);
  const [view] = await withEffects([outcome]);
  return c.json({ lesson: view });
});

/** Gone for good. */
lessonsRouter.delete("/:id", idParam, async (c) => {
  const [row] = await getDb()
    .delete(aiLessons)
    .where(eq(aiLessons.id, c.req.valid("param").id))
    .returning({ id: aiLessons.id });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
