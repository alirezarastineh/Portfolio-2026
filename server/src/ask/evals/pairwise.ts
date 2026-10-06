/**
 * Pairwise evaluation: the evaluation stack's second layer used for ranking,
 * not grading ("use Layer 2 for ranking, not for grading"). The same cases
 * are answered by variant A and variant B, and a judge sees both answers
 * twice, their positions swapped. A verdict counts only when both orders
 * agree; when they disagree, the judge's position bias is showing, and the
 * share of pairs whose orders agree is reported as the swap agreement.
 *
 * This module is the pure part: the verdicts and their summary. The runner
 * lives in `pairwise-run.ts`.
 */

/** The judge's pick for one order: the answer shown first, second, or neither. */
export type PairChoice = "first" | "second" | "tie";
/** Both orders together: A better, B better, a tie, or orders that disagree. */
export type PairOutcome = "a" | "b" | "tie" | "inconsistent";

const aFirstToSide: Record<PairChoice, "a" | "b" | "tie"> = {
  first: "a",
  second: "b",
  tie: "tie",
};

const bFirstToSide: Record<PairChoice, "a" | "b" | "tie"> = {
  first: "b",
  second: "a",
  tie: "tie",
};

/** One judgment with A shown first and one with B shown first, as one outcome. */
export function combineOrders(aFirst: PairChoice, bFirst: PairChoice): PairOutcome {
  const one = aFirstToSide[aFirst];
  const two = bFirstToSide[bFirst];
  return one === two ? one : "inconsistent";
}

export interface PairwiseSide {
  answer: string;
  model: string | null;
  /** The deterministic graders' failures for this side (as in a normal eval). */
  failures: string[];
  usd: number;
}

export interface PairwiseCaseResult {
  id: string;
  category: string;
  /**
   * `judged` when both orders were judged, or a side forfeited (its answer
   * failed on its own; `verdicts` is then null); `unavailable` when an answer
   * or a judgment could not be had (quota, outage), so the case can be resumed.
   */
  status: "judged" | "unavailable";
  a: PairwiseSide;
  b: PairwiseSide;
  verdicts: { aFirst: PairChoice; bFirst: PairChoice } | null;
  outcome: PairOutcome | null;
  /** The judge's reasons, A-first then B-first. */
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
  /** Cases the deterministic graders passed, per side, out of those judged. */
  passed: { a: number; b: number };
  tally: PairwiseTally;
  byCategory: Record<string, PairwiseTally>;
  /**
   * Share of the cases the judge saw whose two orders agreed (a forfeit is
   * not one); null when it saw none.
   */
  swapAgreement: number | null;
  usd: number;
}

const emptyTally = (): PairwiseTally => ({ a: 0, b: 0, tie: 0, inconsistent: 0 });

export function summarizePairwise(input: {
  a: string;
  b: string;
  judge: string | null;
  cases: number;
  results: readonly PairwiseCaseResult[];
}): PairwiseSummary {
  const tally = emptyTally();
  const byCategory: Record<string, PairwiseTally> = {};
  const passed = { a: 0, b: 0 };
  let judged = 0;
  /** Cases the judge saw in both orders: what the swap agreement is about. */
  let seen = 0;
  for (const result of input.results) {
    if (result.status !== "judged" || !result.outcome) continue;
    judged++;
    if (result.verdicts) seen++;
    tally[result.outcome]++;
    byCategory[result.category] ??= emptyTally();
    byCategory[result.category][result.outcome]++;
    if (!result.a.failures.length) passed.a++;
    if (!result.b.failures.length) passed.b++;
  }
  return {
    a: input.a,
    b: input.b,
    judge: input.judge,
    cases: input.cases,
    judged,
    unavailable: input.results.filter((r) => r.status === "unavailable").length,
    passed,
    tally,
    byCategory,
    swapAgreement: seen ? (seen - tally.inconsistent) / seen : null,
    usd: input.results.reduce((sum, r) => sum + r.usd, 0),
  };
}
