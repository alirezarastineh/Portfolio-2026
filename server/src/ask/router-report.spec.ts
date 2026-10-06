import { describe, expect, it } from "vitest";

import { percentile, routerReport, tierOf, type RouterRow } from "./router-report.js";

/** Plan phase 20: the router's report, the false-simple rate at its centre. */

let n = 0;
function row(change: Partial<RouterRow> = {}): RouterRow {
  n++;
  return {
    id: `m_row${String(n).padStart(4, "0")}`,
    sessionHash: `session-${n}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, n)),
    question: `Question ${n}?`,
    finishReason: "stop",
    usd: 0.001,
    flags: [],
    feedback: null,
    faithfulness: null,
    unknown: false,
    handoffOffered: false,
    handoffConfirmed: false,
    route: "lite",
    ttftMs: 1_000,
    routing: { reason: "default" },
    escalation: null,
    ...change,
  };
}

describe("the router's tiers", () => {
  it("reads the tier from the logged route and the trace's routing", () => {
    expect(tierOf({ route: "lite", routing: { lookup: true } })).toBe("lookup");
    expect(tierOf({ route: "lite", routing: null })).toBe("lite");
    expect(tierOf({ route: "lite→deep", routing: { lookup: true } })).toBe("escalated");
    expect(tierOf({ route: "deep", routing: null })).toBe("deep");
    expect(tierOf({ route: "answer-only", routing: { reason: "default" } })).toBe("answer-only");
  });

  it("takes percentiles by nearest rank", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
    expect(percentile([100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000], 0.9)).toBe(900);
  });
});

describe("routerReport", () => {
  it("counts the answers kept lite that went wrong, why, and lists the newest first", () => {
    const session = "session-rephrase";
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 2, 9, minute));
    const rows = [
      row({ flags: ["uncited"] }),
      row({ feedback: -1, routing: { reason: "default+lookup", lookup: true } }),
      // A near-duplicate question a minute later: the first answer did not land.
      row({
        sessionHash: session,
        createdAt: at(0),
        question: "Where did he study computer science?",
      }),
      row({
        sessionHash: session,
        createdAt: at(1),
        question: "Where did he study computer science exactly?",
      }),
      // A flag on the question (an injection attempt) says nothing about the answer, nor
      // does a fallback that answered, a provider's block or the wrong language: no route
      // would have done better.
      row({ flags: ["injection-attempt", "degraded", "blocked", "language", "leak"] }),
      row(),
      // Errors and aborts are not kept answers; deep and escalated are not kept simple.
      row({ finishReason: "error:unavailable", flags: ["uncited"] }),
      row({ route: "deep", feedback: -1, routing: { reason: "compare" } }),
      row({ route: "lite→deep", escalation: "projects-fetched", feedback: -1 }),
    ];
    const { falseSimple } = routerReport(rows);
    // Kept lite and answered: 6 (the two rephrase rows, the flagged, the 👎 lookup, two plain).
    expect(falseSimple).toMatchObject({
      kept: 6,
      candidates: 3,
      byReason: { flagged: 1, "thumbs-down": 1, rephrased: 1 },
    });
    expect(falseSimple.rate).toBeCloseTo(3 / 6);
    expect(falseSimple.listed.map((c) => [c.question, c.tier, c.reasons])).toEqual([
      ["Where did he study computer science?", "lite", ["rephrased"]],
      [rows[1]!.question, "lookup", ["thumbs-down"]],
      [rows[0]!.question, "lite", ["flagged"]],
    ]);
  });

  it("splits speed, cost and helpfulness by tier, with escalations and careful topics", () => {
    const rows = [
      row({ routing: { reason: "default+lookup", lookup: true }, ttftMs: 400 }),
      row({ routing: { reason: "default+lookup", lookup: true }, ttftMs: 600, usd: 0.003 }),
      row({ ttftMs: 1_200 }),
      row({ route: "lite→deep", escalation: "projects-fetched", ttftMs: 2_000 }),
      row({ route: "lite→deep", escalation: "search-spans-projects", ttftMs: 2_400 }),
      row({
        route: "deep",
        routing: { reason: "compare+sensitive:compensation", sensitive: "compensation" },
        ttftMs: 3_000,
      }),
      row({ routing: { reason: "default+sensitive:family", sensitive: "family" }, ttftMs: null }),
    ];
    const report = routerReport(rows);
    const lookup = report.tiers.find((t) => t.tier === "lookup")!;
    expect(lookup).toMatchObject({ answers: 2, p50TtftMs: 400, p90TtftMs: 600, helpfulRate: 1 });
    expect(lookup.usdPerAnswer).toBeCloseTo(0.002);
    expect(report.tiers.find((t) => t.tier === "lite")).toMatchObject({
      answers: 2,
      p50TtftMs: 1_200,
    });
    expect(report.tiers.find((t) => t.tier === "answer-only")).toMatchObject({
      answers: 0,
      p50TtftMs: null,
      usdPerAnswer: null,
      helpfulRate: null,
    });
    // Two of the six routed lite (two lookups, two lite, two moved up) moved up.
    expect(report.escalation).toMatchObject({
      answers: 2,
      byReason: { "projects-fetched": 1, "search-spans-projects": 1 },
    });
    expect(report.escalation.rate).toBeCloseTo(2 / 6);
    expect(report.sensitive).toEqual({ answers: 2, byTopic: { compensation: 1, family: 1 } });
    expect(routerReport([])).toMatchObject({
      answers: 0,
      escalation: { rate: null },
      falseSimple: { rate: null, kept: 0, candidates: 0, listed: [] },
    });
  });
});
