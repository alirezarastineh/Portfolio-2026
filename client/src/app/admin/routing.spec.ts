import { describe, expect, it } from "vitest";

import {
  escalationLine,
  falseSimpleLine,
  seconds,
  sensitiveLine,
  tierRows,
  type RouterView,
} from "./routing";

const view = (change: Partial<RouterView> = {}): RouterView => ({
  days: 7,
  answers: 42,
  tiers: [
    {
      tier: "lookup",
      answers: 12,
      p50TtftMs: 800,
      p90TtftMs: 1_460,
      usdPerAnswer: 0.0009,
      helpfulRate: 0.92,
    },
    {
      tier: "lite",
      answers: 25,
      p50TtftMs: 1_600,
      p90TtftMs: 3_100,
      usdPerAnswer: 0.0021,
      helpfulRate: 0.84,
    },
    {
      tier: "escalated",
      answers: 3,
      p50TtftMs: 2_400,
      p90TtftMs: 2_400,
      usdPerAnswer: 0.006,
      helpfulRate: 1,
    },
    {
      tier: "deep",
      answers: 2,
      p50TtftMs: 4_000,
      p90TtftMs: 5_000,
      usdPerAnswer: 0.01,
      helpfulRate: 0.5,
    },
    {
      tier: "answer-only",
      answers: 0,
      p50TtftMs: null,
      p90TtftMs: null,
      usdPerAnswer: null,
      helpfulRate: null,
    },
  ],
  sensitive: { answers: 3, byTopic: { family: 1, compensation: 2 } },
  escalation: {
    answers: 3,
    rate: 0.075,
    byReason: { "projects-fetched": 2, "search-spans-projects": 1 },
  },
  falseSimple: {
    rate: 0.081,
    kept: 37,
    candidates: 3,
    byReason: { flagged: 1, "thumbs-down": 0, rephrased: 2 },
    listed: [],
  },
  ...change,
});

describe("the router's report in the Overview", () => {
  it("shows the tiers with answers, their speed, cost and helpful share", () => {
    expect(tierRows(view())).toEqual([
      {
        tier: "lookup",
        label: "Lookup (minimal thinking)",
        answers: 12,
        ttft: "0.8 s / 1.5 s",
        usdPerAnswer: "$0.00090",
        helpful: "92 %",
      },
      expect.objectContaining({ tier: "lite", ttft: "1.6 s / 3.1 s" }),
      expect.objectContaining({ tier: "escalated", label: "Lite, moved up to deep" }),
      expect.objectContaining({ tier: "deep", helpful: "50 %" }),
    ]);
    expect(seconds(null)).toBe("–");
  });

  it("says how often the lite route went wrong, and why", () => {
    expect(falseSimpleLine(view())).toBe(
      "3 of 37 answers kept on the lite route went wrong (8 %): 1 flagged, 2 rephrased",
    );
    const none = view().falseSimple;
    expect(
      falseSimpleLine(view({ falseSimple: { ...none, kept: 0, candidates: 0, rate: null } })),
    ).toBeNull();
    expect(
      falseSimpleLine(
        view({
          falseSimple: {
            ...none,
            kept: 1,
            candidates: 0,
            rate: 0,
            byReason: { flagged: 0, "thumbs-down": 0, rephrased: 0 },
          },
        }),
      ),
    ).toBe("0 of 1 answer kept on the lite route went wrong (0 %)");
  });

  it("names the escalations and the careful topics, most frequent first", () => {
    expect(escalationLine(view())).toBe(
      "3 moved up to the deep chain mid-answer (8 % of those routed lite): 2 fetched two projects, 1 a search spanned two projects",
    );
    expect(sensitiveLine(view())).toBe(
      "Careful answers (the newspaper test): 3 (pay and rates 2, family 1)",
    );
    expect(escalationLine(view({ escalation: { answers: 0, rate: 0, byReason: {} } }))).toBeNull();
    expect(sensitiveLine(view({ sensitive: { answers: 0, byTopic: {} } }))).toBeNull();
  });
});
