import { describe, expect, it } from "vitest";

import type { RunRow } from "./assistant-types";
import {
  calibrationLine,
  judgeMark,
  pairwiseSummary,
  tallyRows,
  verdictLine,
  type JudgeStatus,
  type PairwiseSummary,
} from "./pairwise";

const summary: PairwiseSummary = {
  a: "lite",
  b: "deep",
  judge: "judge-x",
  cases: 4,
  judged: 4,
  unavailable: 0,
  passed: { a: 3, b: 4 },
  tally: { a: 1, b: 2, tie: 0, inconsistent: 1 },
  byCategory: {
    fact: { a: 1, b: 1, tie: 0, inconsistent: 1 },
    german: { a: 0, b: 1, tie: 0, inconsistent: 0 },
  },
  swapAgreement: 0.75,
  usd: 0.01,
};

describe("pairwise runs in the admin", () => {
  it("reads a pairwise run's summary, and nothing from an eval run", () => {
    const run = { kind: "pairwise", summary } as unknown as RunRow;
    expect(pairwiseSummary(run)).toBe(summary);
    expect(pairwiseSummary({ ...run, kind: "eval" })).toBeNull();
  });

  it("tallies per category with a total, and says who is ahead", () => {
    expect(tallyRows(summary).map((r) => [r.category, r.a, r.b])).toEqual([
      ["fact", 1, 1],
      ["german", 0, 1],
      ["all", 1, 2],
    ]);
    expect(verdictLine(summary)).toBe("B (deep) ahead: 1 to 2, 0 ties; the orders disagreed on 1.");
  });

  it("describes the judge's calibration, or that there is not enough yet", () => {
    const base = { agree: 0, judgeLenient: 0, judgeStrict: 0 };
    expect(calibrationLine({ ...base, pairs: 3, agreement: 1, calibrated: null })).toMatch(
      /^Not enough reviews yet: 3 of 10/,
    );
    expect(
      calibrationLine({
        pairs: 20,
        agree: 12,
        agreement: 0.6,
        calibrated: false,
        judgeLenient: 6,
        judgeStrict: 2,
      }),
    ).toBe(
      "Uncalibrated: the judge agrees with reviewers on 60 % of 20 answers (6 passed that reviewers failed, 2 the reverse).",
    );
  });

  it("marks a judge by what the reviews say of it", () => {
    const status = (calibrated: boolean | null): JudgeStatus => ({
      fixtureJudge: "judge-x",
      visitorJudge: "judge-x",
      calibration: {
        pairs: 12,
        agree: 6,
        agreement: 0.5,
        calibrated,
        judgeLenient: 3,
        judgeStrict: 3,
      },
      unjudged: 0,
      answerers: ["lite", "deep"],
    });
    expect(judgeMark("judge-x", status(false))).toBe("uncalibrated");
    expect(judgeMark("judge-x", status(true))).toBe("calibrated");
    expect(judgeMark("judge-x", status(null))).toBe("calibration: too few reviews");
    // Reviewers label visitor answers: they cannot speak for another judge.
    expect(judgeMark("judge-y", status(true))).toBe("not calibrated against reviewers");
    expect(judgeMark(null, status(true))).toBeNull();
  });
});
