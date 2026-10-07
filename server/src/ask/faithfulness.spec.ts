import { describe, expect, it } from "vitest";

import { faithfulnessBy, type JudgedRow } from "./faithfulness.js";

/** Plan phase 26: judged faithfulness per model and route, the random sample apart. */

const row = (over: Partial<JudgedRow>): JudgedRow => ({
  model: "gemini-flash-lite",
  route: "lite",
  faithfulness: 1,
  helpfulness: 5,
  pick: "sample",
  ...over,
});

describe("faithfulness per model and route", () => {
  it("averages the random sample apart from every judged answer, and counts those below 0.8", () => {
    const rows = [
      row({ faithfulness: 1, helpfulness: 5 }),
      row({ faithfulness: 0.9, helpfulness: 4 }),
      // A flagged pick and a calibration verdict: in "all" only.
      row({ faithfulness: 0.4, helpfulness: 2, pick: "flagged" }),
      row({ faithfulness: 0.6, helpfulness: 3, pick: null }),
      row({ model: "gemini-flash", route: "deep", faithfulness: 0.7, helpfulness: 4 }),
    ];
    expect(faithfulnessBy(rows, (r) => r.model ?? "none")).toEqual([
      {
        key: "gemini-flash-lite",
        sampled: { judged: 2, faithfulness: 0.95, helpfulness: 4.5, below: 0 },
        all: { judged: 4, faithfulness: 0.725, helpfulness: 3.5, below: 2 },
      },
      {
        key: "gemini-flash",
        sampled: { judged: 1, faithfulness: 0.7, helpfulness: 4, below: 1 },
        all: { judged: 1, faithfulness: 0.7, helpfulness: 4, below: 1 },
      },
    ]);
    const byRoute = faithfulnessBy(
      [...rows, row({ route: "lite→deep", pick: "flagged", faithfulness: 0.5 })],
      (r) => r.route,
    );
    expect(byRoute.map((r) => r.key)).toEqual(["lite", "deep", "lite→deep"]);
    // No sampled answer on a route: nothing to average.
    expect(byRoute[2]!.sampled).toEqual({
      judged: 0,
      faithfulness: null,
      helpfulness: null,
      below: 0,
    });
    expect(faithfulnessBy([], (r) => r.route)).toEqual([]);
  });
});
