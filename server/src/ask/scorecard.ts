import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiGuardEvents, aiMessages } from "../db/schema.js";
import recorded from "./evals/baseline.json" with { type: "json" };
import { baselineOf, type Baseline } from "./evals/baseline.js";
import { REFUSAL_KINDS } from "./guard-events.js";
import { utcDay } from "./guard.js";
import { PROMPT_HASH, PROMPT_VERSION } from "./prompt.js";
import type { AiSettings } from "./settings.js";

/**
 * The assistant's public scorecard (visitor plan V13): how well it does, for
 * anyone who asks (`GET /v1/ask/scorecard`, the terminal's `evals`). Two
 * layers of the evaluation stack:
 *   - the eval run recorded for the deployed prompt, built into the API from
 *     `evals/baseline.json`, which CI's prompt guard ties to that prompt (a
 *     version shipped on a waiver says so, with the waiver's reason);
 *   - the last 30 days of visitors' answers, as counts and shares, each shown
 *     only with at least 20 answers behind it, and the nightly judge's random
 *     sample while that runs.
 * Aggregates only: no question, answer, session or address leaves. No model
 * is called, and it works with the assistant off.
 */

export const SCORECARD_DAYS = 30;
/** The fewest answers a figure needs before it is shown; below, "not enough answers yet". */
export const SCORECARD_MINIMUM = 20;
const CACHE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A share of `n` answers; null below the minimum. */
export type Share = { share: number; n: number } | null;

export interface RecordedCategory {
  name: string;
  cases: number;
  completed: number;
  passed: number;
}

export type RecordedRun =
  | {
      measured: true;
      at: string;
      cases: number;
      completed: number;
      passed: number;
      passRate: number;
      /** The judge's model, which scored faithfulness and helpfulness. */
      judge: string | null;
      categories: RecordedCategory[];
    }
  /** Shipped on a waiver (its reason), or with neither a run nor a waiver (null). */
  | { measured: false; reason: string | null };

export interface LiveChecks {
  days: number;
  minimum: number;
  /** Visitors' questions answered in the window; the ones no model could answer are `unanswered`. */
  answers: number;
  unanswered: Share;
  /** Of the answers that cite, those whose every reference is a published document. */
  citationsVerified: Share;
  /** Answers that had no words at first and were written again. */
  repaired: Share;
  /** Answers stating a figure that no cited document holds. */
  figuresFlagged: Share;
  /** The median time to the first visible word, as visitors' browsers measured it. */
  firstWordMs: { median: number; n: number } | null;
  /** Requests turned away, by kind. */
  refusals: Partial<Record<(typeof REFUSAL_KINDS)[number], number>> | null;
}

export interface Scorecard {
  v: 1;
  /** The deployed prompt, `version+hash`. */
  prompt: string;
  recorded: RecordedRun;
  live: LiveChecks;
  /** The nightly judge's random sample, while it runs: its median faithfulness (0–1). */
  judge: { median: number | null; n: number } | null;
  /** When the figures were computed; they are held ten minutes. */
  at: string;
}

const BUILT_IN = baselineOf(recorded, "the built-in eval baseline");
export const DEPLOYED_PROMPT = `${PROMPT_VERSION}+${PROMPT_HASH}`;

/** The recorded run of the deployed prompt, or why there is none. */
export function recordedRun(baseline: Baseline, deployed: string): RecordedRun {
  const { at, cases, passRate } = baseline;
  if (baseline.promptVersion !== deployed || passRate === null || !at || cases === null) {
    return { measured: false, reason: baseline.waivers[deployed] ?? null };
  }
  const categories = Object.entries(baseline.byCategory).map(([name, row]) => ({
    name,
    cases: row.cases,
    completed: row.completed,
    passed: row.passed,
  }));
  return {
    measured: true,
    at,
    cases,
    completed: categories.reduce((sum, row) => sum + row.completed, 0),
    passed: categories.reduce((sum, row) => sum + row.passed, 0),
    passRate,
    judge: baseline.judge,
    categories,
  };
}

const share = (part: number, whole: number): Share =>
  whole >= SCORECARD_MINIMUM ? { share: part / whole, n: whole } : null;

/** The window's figures, in one pass over the visitors' answers and one over the refusals. */
export async function liveChecks(
  now = new Date(),
): Promise<{ live: LiveChecks; judged: { median: number | null; n: number } }> {
  const since = new Date(now.getTime() - SCORECARD_DAYS * DAY_MS);
  const failed = sql`${aiMessages.finishReason} like 'error:%'`;
  const citing = sql`(jsonb_array_length(${aiMessages.citedIds}) > 0 or jsonb_array_length(${aiMessages.droppedCitations}) > 0)`;
  const flagged = (flag: string) =>
    sql`coalesce(${aiMessages.checks} -> 'flags', '[]'::jsonb) @> ${JSON.stringify([flag])}::jsonb`;
  const shown = sql`(${aiMessages.signals} ->> 'shownMs')::float8`;
  const sampled = sql`${aiMessages.judge} ->> 'pick' = 'sample'`;
  const faithfulness = sql`(${aiMessages.judge} ->> 'faithfulness')::float8`;
  const [row] = await getDb()
    .select({
      asked: sql<number>`count(*)::int`,
      failed: sql<number>`(count(*) filter (where ${failed}))::int`,
      citing: sql<number>`(count(*) filter (where not ${failed} and ${citing}))::int`,
      verified: sql<number>`(count(*) filter (where not ${failed} and ${citing} and jsonb_array_length(${aiMessages.droppedCitations}) = 0))::int`,
      repaired: sql<number>`(count(*) filter (where not ${failed} and ${flagged("repaired")}))::int`,
      figures: sql<number>`(count(*) filter (where not ${failed} and ${flagged("ungrounded-figure")}))::int`,
      shown: sql<number>`(count(${shown}) filter (where not ${failed}))::int`,
      shownMedian: sql<
        number | null
      >`percentile_disc(0.5) within group (order by ${shown}) filter (where not ${failed})`,
      judged: sql<number>`(count(${faithfulness}) filter (where ${sampled}))::int`,
      faithfulMedian: sql<
        number | null
      >`percentile_disc(0.5) within group (order by ${faithfulness}) filter (where ${sampled})`,
    })
    .from(aiMessages)
    .where(and(eq(aiMessages.source, "terminal"), gte(aiMessages.createdAt, since)));
  const counts = row ?? {
    asked: 0,
    failed: 0,
    citing: 0,
    verified: 0,
    repaired: 0,
    figures: 0,
    shown: 0,
    shownMedian: null,
    judged: 0,
    faithfulMedian: null,
  };
  const answers = counts.asked - counts.failed;
  const enough = answers >= SCORECARD_MINIMUM;

  const refusals = enough
    ? await getDb()
        .select({
          kind: aiGuardEvents.kind,
          count: sql<number>`sum(${aiGuardEvents.count})::int`,
        })
        .from(aiGuardEvents)
        .where(
          and(
            gte(aiGuardEvents.day, utcDay(since)),
            inArray(aiGuardEvents.kind, [...REFUSAL_KINDS]),
          ),
        )
        .groupBy(aiGuardEvents.kind)
        .orderBy(aiGuardEvents.kind)
    : null;

  return {
    live: {
      days: SCORECARD_DAYS,
      minimum: SCORECARD_MINIMUM,
      answers,
      unanswered: share(counts.failed, counts.asked),
      citationsVerified: share(counts.verified, counts.citing),
      repaired: share(counts.repaired, answers),
      figuresFlagged: share(counts.figures, answers),
      firstWordMs:
        counts.shown >= SCORECARD_MINIMUM && counts.shownMedian !== null
          ? { median: Math.round(Number(counts.shownMedian)), n: counts.shown }
          : null,
      refusals: refusals && Object.fromEntries(refusals.map((r) => [r.kind, r.count])),
    },
    judged: {
      median:
        counts.judged >= SCORECARD_MINIMUM && counts.faithfulMedian !== null
          ? Number(counts.faithfulMedian)
          : null,
      n: counts.judged,
    },
  };
}

let cached: { at: number; judge: boolean; value: Promise<Scorecard> } | null = null;

/** For tests: the next read computes afresh. */
export function resetScorecardCache(): void {
  cached = null;
}

async function compute(judgeRuns: boolean, now: Date): Promise<Scorecard> {
  const { live, judged } = await liveChecks(now);
  return {
    v: 1,
    prompt: DEPLOYED_PROMPT,
    recorded: recordedRun(BUILT_IN, DEPLOYED_PROMPT),
    live,
    judge: judgeRuns ? judged : null,
    at: now.toISOString(),
  };
}

/** The scorecard as of at most ten minutes ago; the judge's figures while the nightly judge runs. */
export function scorecard(
  settings: Pick<AiSettings, "featureSwitches">,
  now = Date.now(),
): Promise<Scorecard> {
  const judge = settings.featureSwitches.nightlyJudge;
  if (!cached || now - cached.at > CACHE_MS || cached.judge !== judge) {
    const value = compute(judge, new Date(now));
    cached = { at: now, judge, value };
    value.catch(() => {
      if (cached?.value === value) cached = null;
    });
  }
  return cached.value;
}
