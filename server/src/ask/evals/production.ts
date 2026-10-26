import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiCorpusSnapshots, aiEvalCases, aiMessages } from "../../db/schema.js";
import type { AskCorpus } from "../corpus/index.js";
import { askCorpusFromSnapshot, type CorpusSnapshot } from "../corpus/snapshots.js";
import type { ToolName } from "../tools.js";
import type { EvalCase } from "./cases.js";
import { runEvals, type CaseResult, type EvalOptions } from "./run.js";
import { VISITOR_ANSWER } from "../outcome-rows.js";

/**
 * Eval cases frozen from real visitor answers (plan phase 12, the book's
 * "bootstrap evaluations from real work"): the redacted question, the answer's
 * corpus snapshot, and what a good answer must do. Each re-runs against its
 * own snapshot, so a later publish never changes what it tests; a quarterly
 * staleness list shows the cases whose documents have changed since.
 */

export interface CaseExpectations {
  /**
   * The question as the admin rewrote it to remove anything personal: a case
   * outlives the 90 days the visitor's own question is kept. Defaults to the
   * logged (redacted) question.
   */
  question?: string;
  /**
   * The visitor's earlier questions in the session (visitor plan V3), oldest
   * first, each as the admin rewrote it. Their answers are generated again
   * at each replay, so none of the visitor's answers is kept.
   */
  turns?: string[];
  mustCite?: string[];
  citeAny?: string[];
  mustInclude?: string[];
  mustNotInclude?: string[];
  expectTool?: { name: ToolName; input?: Record<string, unknown> } | null;
  judge?: boolean;
}

/** The most earlier questions a frozen case takes. */
export const MAX_FROZEN_TURNS = 3;

export type FreezeResult =
  { ok: true; id: string } | { ok: false; error: "not_found" | "no_snapshot" };

/**
 * The questions asked before a visitor's answer in its session, at most
 * three, oldest first: what "Freeze as eval case" offers as its turns, for
 * the admin to rewrite or leave out. Null when the answer is not a visitor's.
 */
export async function earlierQuestions(messageId: string): Promise<string[] | null> {
  const db = getDb();
  const [message] = await db
    .select({ sessionHash: aiMessages.sessionHash })
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), VISITOR_ANSWER));
  if (!message) return null;
  // Compared in SQL: the row's own timestamp keeps microseconds a JS date would lose.
  const asked = db
    .select({ createdAt: aiMessages.createdAt })
    .from(aiMessages)
    .where(eq(aiMessages.id, messageId));
  const rows = await db
    .select({ question: aiMessages.questionRedacted })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.sessionHash, message.sessionHash),
        VISITOR_ANSWER,
        lt(aiMessages.createdAt, sql`(${asked})`),
      ),
    )
    .orderBy(desc(aiMessages.createdAt))
    .limit(MAX_FROZEN_TURNS);
  return rows.map((row) => row.question).reverse();
}

/** A case from a logged visitor answer; `mustCite` defaults to what it cited. */
export async function freezeCase(
  messageId: string,
  expectations: CaseExpectations = {},
): Promise<FreezeResult> {
  const db = getDb();
  const [message] = await db
    .select({
      question: aiMessages.questionRedacted,
      locale: aiMessages.locale,
      corpusKey: aiMessages.corpusKey,
      citedIds: aiMessages.citedIds,
    })
    .from(aiMessages)
    .where(and(eq(aiMessages.id, messageId), VISITOR_ANSWER));
  if (!message) return { ok: false, error: "not_found" };
  const [snapshot] = message.corpusKey
    ? await db
        .select({ key: aiCorpusSnapshots.key })
        .from(aiCorpusSnapshots)
        .where(eq(aiCorpusSnapshots.key, message.corpusKey))
    : [];
  if (!snapshot) return { ok: false, error: "no_snapshot" };

  const [row] = await db
    .insert(aiEvalCases)
    .values({
      question: expectations.question ?? message.question,
      turns: expectations.turns?.length
        ? expectations.turns.map((question) => ({ question }))
        : null,
      locale: message.locale,
      snapshotKey: snapshot.key,
      mustCite: expectations.mustCite ?? message.citedIds,
      citeAny: expectations.citeAny ?? [],
      mustInclude: expectations.mustInclude ?? [],
      mustNotInclude: expectations.mustNotInclude ?? [],
      expectTool: expectations.expectTool ?? null,
      judge: expectations.judge ?? true,
      fromMessageId: messageId,
    })
    .returning({ id: aiEvalCases.id });
  return { ok: true, id: row!.id };
}

export interface ProductionCase {
  evalCase: EvalCase;
  snapshotKey: string;
}

/** The active production cases, as eval cases, each with its snapshot's key. */
export async function productionCases(): Promise<ProductionCase[]> {
  const rows = await getDb()
    .select()
    .from(aiEvalCases)
    .where(and(eq(aiEvalCases.suite, "production"), eq(aiEvalCases.status, "active")));
  return rows.map((row) => ({
    snapshotKey: row.snapshotKey,
    evalCase: {
      id: `prod-${row.id.slice(0, 8)}`,
      // Graded like facts: cited, in the question's language.
      category: "production",
      locale: row.locale,
      question: row.question,
      // Each earlier question answered live at the replay, its answer regenerated.
      ...(row.turns?.length ? { turns: row.turns.map(({ question }) => ({ question })) } : {}),
      ...(row.mustCite.length ? { mustCite: row.mustCite } : {}),
      ...(row.citeAny.length ? { citeAny: row.citeAny } : {}),
      ...(row.mustInclude.length ? { mustInclude: row.mustInclude } : {}),
      ...(row.mustNotInclude.length ? { mustNotInclude: row.mustNotInclude } : {}),
      ...(row.expectTool ? { expectTool: row.expectTool } : {}),
      judge: row.judge,
    },
  }));
}

/** The snapshots the cases need, as corpora. */
export async function snapshotCorpora(keys: readonly string[]): Promise<Map<string, AskCorpus>> {
  if (!keys.length) return new Map();
  const rows = await getDb()
    .select()
    .from(aiCorpusSnapshots)
    .where(inArray(aiCorpusSnapshots.key, [...new Set(keys)]));
  return new Map(
    rows.map((row) => [row.key, askCorpusFromSnapshot(row as unknown as CorpusSnapshot)]),
  );
}

/**
 * Runs every active production case against its own snapshot: the cases are
 * grouped by snapshot and each group runs on that snapshot's corpus. Stops at
 * the first group that cannot finish (quota, outage), as the suite does.
 */
export async function runProductionSuite(
  options: Omit<EvalOptions, "cases" | "corpus">,
): Promise<{ planned: number; results: CaseResult[]; missing: number }> {
  const cases = await productionCases();
  const corpora = await snapshotCorpora(cases.map((c) => c.snapshotKey));
  const bySnapshot = new Map<string, EvalCase[]>();
  for (const { evalCase, snapshotKey } of cases) {
    bySnapshot.set(snapshotKey, [...(bySnapshot.get(snapshotKey) ?? []), evalCase]);
  }
  const results: CaseResult[] = [];
  let missing = 0;
  for (const [key, group] of bySnapshot) {
    const corpus = corpora.get(key);
    if (!corpus) {
      missing += group.length;
      continue;
    }
    const summary = await runEvals({ ...options, cases: group, corpus });
    results.push(...summary.results);
    if (summary.incomplete) break;
  }
  return { planned: cases.length, results, missing };
}

/**
 * The quarterly staleness check: `gone` when a document the case must cite no
 * longer exists in the live corpus, `changed` when its text differs from the
 * snapshot's, null while it still says the same.
 */
export function staleness(
  cited: readonly string[],
  snapshot: Pick<AskCorpus, "byId">,
  live: Pick<AskCorpus, "byId">,
): "gone" | "changed" | null {
  let changed = false;
  for (const id of cited) {
    const now = live.byId.get(id);
    if (!now) return "gone";
    if (now.text !== snapshot.byId.get(id)?.text) changed = true;
  }
  return changed ? "changed" : null;
}
