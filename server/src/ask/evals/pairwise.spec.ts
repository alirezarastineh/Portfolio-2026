import { describe, expect, it } from "vitest";

import {
  combineOrders,
  summarizePairwise,
  type PairOutcome,
  type PairwiseCaseResult,
} from "./pairwise.js";

function result(
  id: string,
  category: string,
  outcome: PairOutcome | null,
  change: Partial<PairwiseCaseResult> = {},
): PairwiseCaseResult {
  const side = { answer: "x", model: "m", failures: [], usd: 0.001 };
  return {
    id,
    category,
    status: outcome ? "judged" : "unavailable",
    a: side,
    b: side,
    verdicts: null,
    outcome,
    reasons: [],
    usd: 0.004,
    ...change,
  };
}

describe("pairwise verdicts", () => {
  it("counts a verdict only when both orders pick the same answer", () => {
    // A shown first and picked first; B shown first and picked second: A both times.
    expect(combineOrders("first", "second")).toBe("a");
    expect(combineOrders("second", "first")).toBe("b");
    expect(combineOrders("tie", "tie")).toBe("tie");
    // The first position won both times: position bias, not a verdict.
    expect(combineOrders("first", "first")).toBe("inconsistent");
    expect(combineOrders("second", "second")).toBe("inconsistent");
    expect(combineOrders("first", "tie")).toBe("inconsistent");
  });

  it("tallies wins per category, and the share of pairs whose orders agreed", () => {
    const summary = summarizePairwise({
      a: "lite",
      b: "deep",
      judge: "judge-x",
      cases: 6,
      results: [
        result("f1", "fact", "a"),
        result("f2", "fact", "b"),
        result("f3", "fact", "inconsistent"),
        result("g1", "german", "tie", {
          b: { answer: "y", model: "m", failures: ["did not cite x"], usd: 0.001 },
        }),
        result("g2", "german", null),
      ],
    });
    expect(summary).toMatchObject({
      judged: 4,
      unavailable: 1,
      tally: { a: 1, b: 1, tie: 1, inconsistent: 1 },
      byCategory: {
        fact: { a: 1, b: 1, tie: 0, inconsistent: 1 },
        german: { a: 0, b: 0, tie: 1, inconsistent: 0 },
      },
      passed: { a: 4, b: 3 },
      swapAgreement: 0.75,
    });
    expect(summary.usd).toBeCloseTo(0.02);
    expect(summarizePairwise({ a: "a", b: "b", judge: null, cases: 0, results: [] })).toMatchObject(
      {
        judged: 0,
        swapAgreement: null,
      },
    );
  });
});
