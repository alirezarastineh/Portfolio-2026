import { and, desc, eq, inArray, sql, type AnyColumn } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiCorpusSnapshots, aiFeedback, aiJournal, aiMessages } from "../db/schema.js";
import type { CorpusDocument } from "./corpus/build.js";
import { askConfig, askCorpus } from "./deps.js";
import {
  categoryOf,
  diagnose,
  type DiagnosisAnswer,
  type JournalDiagnosis,
  type Proposal,
  type ReplayRecord,
} from "./journal.js";
import { OUTCOME_COLUMNS } from "./outcome-rows.js";
import { rephrased, REPHRASE_WINDOW_MS } from "./outcomes.js";
import { resolveRequested } from "./perception.js";

/**
 * The failure journal in the database (plan phase 24): a visitor's answer and
 * the corpora Diagnose compares, read; the entries it proposes, written. The
 * admin's routes (journal-routes.ts) and the replay run (runs/replay-work.ts)
 * share it. An analysis never overwrites what the admin wrote: a field is
 * replaced only while it still holds the previous proposal.
 */

export type JournalRow = typeof aiJournal.$inferSelect;

/** An entry as the admin sees it: the row, and its first answer while that is kept. */
export type JournalView = JournalRow & {
  message: { id: string; question: string; createdAt: Date; citedIds: string[] } | null;
};

/** A visitor's answer as Diagnose reads it; null when unknown, pruned or not a visitor's. */
export async function loadAnswer(messageId: string): Promise<DiagnosisAnswer | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: aiMessages.id,
      locale: aiMessages.locale,
      sessionHash: aiMessages.sessionHash,
      question: aiMessages.questionRedacted,
      answer: aiMessages.answerExcerpt,
      citedIds: aiMessages.citedIds,
      toolCalls: aiMessages.toolCalls,
      model: aiMessages.model,
      route: aiMessages.route,
      finishReason: aiMessages.finishReason,
      ttftMs: aiMessages.ttftMs,
      totalMs: aiMessages.totalMs,
      checks: aiMessages.checks,
      feedback: aiFeedback.value,
      faithfulness: sql<number | null>`(${aiMessages.judge} ->> 'faithfulness')::float8`,
      promptVersion: aiMessages.promptVersion,
      corpusKey: aiMessages.corpusKey,
      attempts: aiMessages.attempts,
      trace: aiMessages.trace,
    })
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(and(eq(aiMessages.id, messageId), eq(aiMessages.source, "terminal")));
  if (!row) return null;

  // The session's answers in the window after it: did the visitor ask again? Compared in SQL,
  // which keeps the timestamps' microseconds.
  const after = await db
    .select(OUTCOME_COLUMNS)
    .from(aiMessages)
    .leftJoin(aiFeedback, eq(aiFeedback.messageId, aiMessages.id))
    .where(
      and(
        eq(aiMessages.sessionHash, row.sessionHash),
        eq(aiMessages.source, "terminal"),
        sql`${aiMessages.createdAt} >= (select created_at from ai_messages where id = ${messageId})`,
        sql`${aiMessages.createdAt} <= (select created_at from ai_messages where id = ${messageId}) + make_interval(secs => ${REPHRASE_WINDOW_MS / 1000})`,
      ),
    );

  const { checks, feedback, attempts, ...answer } = row;
  return {
    ...answer,
    feedback: feedback === 1 || feedback === -1 ? feedback : null,
    flags: checks?.flags ?? [],
    checked: checks !== null,
    rephrased: rephrased(after).has(messageId),
    attempts: (attempts as { model?: unknown; outcome?: unknown; ms?: unknown }[]).flatMap((a) =>
      typeof a?.model === "string" && typeof a.outcome === "string"
        ? [{ model: a.model, outcome: a.outcome, ms: typeof a.ms === "number" ? a.ms : 0 }]
        : [],
    ),
  };
}

export interface Corpora {
  /** The documents the answer read; null when its snapshot was not kept. */
  snapshot: CorpusDocument[] | null;
  /** Today's documents; null when today's corpus could not be built. */
  live: CorpusDocument[] | null;
  projectNames: string[];
}

export async function loadCorpora(answer: Pick<DiagnosisAnswer, "corpusKey">): Promise<Corpora> {
  const [stored] = answer.corpusKey
    ? await getDb()
        .select({ documents: aiCorpusSnapshots.documents, projects: aiCorpusSnapshots.projects })
        .from(aiCorpusSnapshots)
        .where(eq(aiCorpusSnapshots.key, answer.corpusKey))
    : [];
  let live: Awaited<ReturnType<typeof askCorpus>> | null = null;
  try {
    live = await askCorpus(askConfig());
  } catch (error) {
    console.error("[journal] today's corpus unavailable", error);
  }
  return {
    snapshot: stored?.documents ?? null,
    live: live?.documents ?? null,
    projectNames: (stored?.projects ?? live?.projects ?? []).map((p) => p.name),
  };
}

/** Whether the admin's named document is one of what the answer read (or of today's, without). */
export function namesKnownDocument(
  corpora: Corpora,
  answer: Pick<DiagnosisAnswer, "locale" | "trace">,
  id: string,
): boolean {
  const documents = corpora.snapshot ?? corpora.live ?? [];
  return !!resolveRequested(documents, id, answer.trace?.core?.locale ?? answer.locale);
}

/** The newest entry that diagnoses this answer. */
export async function entryFor(messageId: string): Promise<JournalRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(aiJournal)
    .where(sql`${aiJournal.messageIds} @> ${JSON.stringify([messageId])}::jsonb`)
    .orderBy(desc(aiJournal.createdAt))
    .limit(1);
  return row;
}

export async function getEntry(id: string): Promise<JournalRow | undefined> {
  const [row] = await getDb().select().from(aiJournal).where(eq(aiJournal.id, id));
  return row;
}

/** The document the admin named in an earlier analysis, kept for the next. */
export const namedIn = (diagnosis: JournalDiagnosis): string | null =>
  diagnosis.located?.named ? diagnosis.located.id : null;

/**
 * The admin's fields after a new analysis, decided in the database at the
 * moment of writing: each takes the new proposal's value only while it still
 * holds the previous proposal's, so an edit saved meanwhile is never lost.
 */
function proposalUnlessEdited(before: Proposal, next: Proposal) {
  const unlessEdited = (column: AnyColumn, was: string | null, now: string | null) =>
    sql`case when ${column} is not distinct from ${was}::text then ${now}::text else ${column} end`;
  return {
    rootCause: unlessEdited(aiJournal.rootCause, before.rootCause, next.rootCause),
    fixType: unlessEdited(aiJournal.fixType, before.fixType, next.fixType),
    fix: unlessEdited(aiJournal.fix, before.fix, next.fix),
    fixRef: unlessEdited(aiJournal.fixRef, before.fixRef, next.fixRef),
    heuristic: unlessEdited(aiJournal.heuristic, before.heuristic, next.heuristic),
  };
}

export async function createEntry(
  messageId: string,
  diagnosis: JournalDiagnosis,
): Promise<JournalRow> {
  const { proposal } = diagnosis;
  const [row] = await getDb()
    .insert(aiJournal)
    .values({
      messageIds: [messageId],
      category: categoryOf(diagnosis),
      diagnosis,
      rootCause: proposal.rootCause,
      fixType: proposal.fixType,
      fix: proposal.fix,
      fixRef: proposal.fixRef,
      heuristic: proposal.heuristic,
    })
    .returning();
  return row!;
}

/**
 * A new analysis of an entry: its diagnosis, and, while it is only proposed,
 * the proposal's fields the admin left as they were. An accepted entry keeps
 * every field the admin decided on. Undefined when the entry's status moved
 * on in the meantime (or it was deleted).
 */
export async function reanalysed(
  row: JournalRow,
  diagnosis: JournalDiagnosis,
  replay?: ReplayRecord,
): Promise<JournalRow | undefined> {
  const [updated] = await getDb()
    .update(aiJournal)
    .set({
      category: categoryOf(diagnosis),
      diagnosis,
      ...(row.status === "proposed"
        ? proposalUnlessEdited(row.diagnosis.proposal, diagnosis.proposal)
        : {}),
      ...(replay ? { replay } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(aiJournal.id, row.id), eq(aiJournal.status, row.status)))
    .returning();
  return updated;
}

/** Statuses a replay may still add evidence to: an entry fixed or retired is the admin's record. */
export const REPLAYABLE: readonly JournalRow["status"][] = ["proposed", "accepted"];

/**
 * A finished replay joins its entry's evidence: the answer analysed again
 * with it. `answer_gone` when the answer was pruned meanwhile, `entry_gone`
 * when the entry was deleted, `entry_decided` when it was fixed or retired.
 * A status that moves while the analysis runs is read again, once.
 */
export async function applyReplay(
  entryId: string,
  replay: ReplayRecord,
  /** The write (tests put a status change in front of it). */
  write: typeof reanalysed = reanalysed,
): Promise<JournalRow | "answer_gone" | "entry_gone" | "entry_decided"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await getEntry(entryId);
    if (!row) return "entry_gone";
    if (!REPLAYABLE.includes(row.status)) return "entry_decided";
    const answer = await loadAnswer(row.messageIds[0] ?? "");
    if (!answer) return "answer_gone";
    const corpora = await loadCorpora(answer);
    if (!corpora.snapshot && !corpora.live) {
      throw new Error("no corpus to analyse the replay with");
    }
    const diagnosis = diagnose({ answer, ...corpora, expected: namedIn(row.diagnosis), replay });
    const updated = await write(row, diagnosis, replay);
    if (updated) return updated;
  }
  return "entry_decided";
}

export async function views(rows: readonly JournalRow[]): Promise<JournalView[]> {
  const ids = [...new Set(rows.flatMap((r) => r.messageIds.slice(0, 1)))];
  const messages = ids.length
    ? await getDb()
        .select({
          id: aiMessages.id,
          question: aiMessages.questionRedacted,
          createdAt: aiMessages.createdAt,
          citedIds: aiMessages.citedIds,
        })
        .from(aiMessages)
        .where(inArray(aiMessages.id, ids))
    : [];
  const byId = new Map(messages.map((m) => [m.id, m]));
  return rows.map((row) => ({ ...row, message: byId.get(row.messageIds[0] ?? "") ?? null }));
}
