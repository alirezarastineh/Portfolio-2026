import type { RunItem, RunRow } from "./assistant-types";

/**
 * Pairwise runs and the judge's calibration, as the admin shows them. The
 * shapes mirror `server/src/ask/evals/pairwise.ts` and `calibration.ts`.
 */

export type PairChoice = "first" | "second" | "tie";
export type PairOutcome = "a" | "b" | "tie" | "inconsistent";

export interface PairwiseSide {
  answer: string;
  model: string | null;
  failures: string[];
  usd: number;
}

export interface PairwiseCaseResult {
  id: string;
  category: string;
  status: "judged" | "unavailable";
  a: PairwiseSide;
  b: PairwiseSide;
  verdicts: { aFirst: PairChoice; bFirst: PairChoice } | null;
  outcome: PairOutcome | null;
  reasons: string[];
  usd: number;
}

export interface PairwiseTally {
  a: number;
  b: number;
  tie: number;
  inconsistent: number;
}

export interface PairwiseSummary {
  a: string;
  b: string;
  judge: string | null;
  cases: number;
  judged: number;
  unavailable: number;
  passed: { a: number; b: number };
  tally: PairwiseTally;
  byCategory: Record<string, PairwiseTally>;
  swapAgreement: number | null;
  usd: number;
}

export interface Calibration {
  pairs: number;
  agree: number;
  agreement: number | null;
  calibrated: boolean | null;
  judgeLenient: number;
  judgeStrict: number;
}

/** `GET /admin/assistant/judge`. */
export interface JudgeStatus {
  /** The judge of eval and pairwise runs (fixture data: any model). */
  fixtureJudge: string | null;
  /** The judge allowed on visitor answers, or null when none is. */
  visitorJudge: string | null;
  calibration: Calibration;
  /** Reviewed answers with a grounded verdict and no verdict from this judge yet. */
  unjudged: number;
  answerers: string[];
}

export const OUTCOME_LABELS: Record<PairOutcome, string> = {
  a: "A better",
  b: "B better",
  tie: "tie",
  inconsistent: "orders disagree",
};

export function pairwiseSummary(run: RunRow): PairwiseSummary | null {
  return run.kind === "pairwise" && run.summary
    ? (run.summary as unknown as PairwiseSummary)
    : null;
}

export function pairwiseResults(items: readonly RunItem[]): PairwiseCaseResult[] {
  return items.flatMap((item) =>
    item.result ? [item.result as unknown as PairwiseCaseResult] : [],
  );
}

/** One row per category, then the total. */
export function tallyRows(summary: PairwiseSummary): ({ category: string } & PairwiseTally)[] {
  return [
    ...Object.entries(summary.byCategory).map(([category, t]) => ({ category, ...t })),
    { category: "all", ...summary.tally },
  ];
}

export function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)} %`;
}

function leader(summary: PairwiseSummary): string {
  const { a, b } = summary.tally;
  if (a === b) return "Even";
  return a > b ? `A (${summary.a}) ahead` : `B (${summary.b}) ahead`;
}

/** Who is ahead among the verdicts that count (both orders agreeing). */
export function verdictLine(summary: PairwiseSummary): string {
  const { a, b, tie, inconsistent } = summary.tally;
  return `${leader(summary)}: ${a} to ${b}, ${tie} ${tie === 1 ? "tie" : "ties"}; the orders disagreed on ${inconsistent}.`;
}

/**
 * How far reviewers back a judge: its calibration when it is the judge of
 * visitor answers (the only one their labels can measure), or that it is not.
 */
export function judgeMark(judge: string | null, status: JudgeStatus | null): string | null {
  if (!judge || !status) return null;
  if (judge !== status.visitorJudge) return "not calibrated against reviewers";
  const { calibrated } = status.calibration;
  if (calibrated === null) return "calibration: too few reviews";
  return calibrated ? "calibrated" : "uncalibrated";
}

export function calibrationLine(c: Calibration): string {
  if (c.calibrated === null) {
    return `Not enough reviews yet: ${c.pairs} of 10 answers have both a judge score and a grounded verdict.`;
  }
  const state = c.calibrated ? "Calibrated" : "Uncalibrated";
  return `${state}: the judge agrees with reviewers on ${percent(c.agreement)} of ${c.pairs} answers (${c.judgeLenient} passed that reviewers failed, ${c.judgeStrict} the reverse).`;
}
