import { describe, expect, it } from "vitest";

import {
  browserView,
  completedWeeks,
  outcomes,
  percentile,
  rephrased,
  shouldRotate,
  similarity,
  weeklyValues,
  type OutcomeRow,
} from "./outcomes.js";

const MINUTE = 60_000;
const start = new Date("2026-09-28T10:00:00Z").getTime();

function row(id: string, change: Partial<OutcomeRow> = {}): OutcomeRow {
  return {
    id,
    sessionHash: "s1",
    createdAt: new Date(start),
    question: `question ${id}`,
    finishReason: "stop",
    usd: 0.002,
    flags: [],
    feedback: null,
    faithfulness: null,
    unknown: false,
    handoffOffered: false,
    handoffConfirmed: false,
    ...change,
  };
}

describe("outcomes", () => {
  it("does not hold a visitor's injection attempt against the answer", () => {
    const rows = [
      row("a", { flags: ["injection-attempt"], question: "What is his stack?" }),
      row("b", { flags: ["uncited"], question: "Where is he based?" }),
    ];
    const result = outcomes(rows, 0);
    // The first stays helpful; the second's flag is about the answer itself.
    expect(result.helpful).toBe(1);
  });

  it("reads a near-duplicate question soon after an answer as a rephrase", () => {
    expect(
      similarity("Where does Alireza live?", "where does alireza live now"),
    ).toBeGreaterThanOrEqual(0.5);
    expect(similarity("Where does he live?", "Which stack does he use?")).toBeLessThan(0.5);

    const rows = [
      row("a", { question: "Where does Alireza live?" }),
      // Asked again a minute later: the first answer did not land.
      row("b", { question: "Where does Alireza live now?", createdAt: new Date(start + MINUTE) }),
      // The same question, but ten minutes on, or in another session: not a rephrase.
      row("c", { question: "Where does Alireza live?", createdAt: new Date(start + 11 * MINUTE) }),
      row("d", { question: "Where does Alireza live?", sessionHash: "s2" }),
    ];
    expect([...rephrased(rows)]).toEqual(["a"]);
  });

  it("counts helpful answers as a composite, and the hand-off funnel", () => {
    const rows = [
      row("ok", { feedback: 1, handoffOffered: true, handoffConfirmed: true }),
      row("flagged", { flags: ["uncited"], createdAt: new Date(start + 10 * MINUTE) }),
      row("down", { feedback: -1, createdAt: new Date(start + 20 * MINUTE) }),
      row("unfaithful", { faithfulness: 0.5, createdAt: new Date(start + 30 * MINUTE) }),
      row("unknown", {
        unknown: true,
        handoffOffered: true,
        createdAt: new Date(start + 40 * MINUTE),
      }),
      row("error", {
        finishReason: "error:unavailable",
        usd: 0,
        createdAt: new Date(start + 50 * MINUTE),
      }),
    ];
    const result = outcomes(rows, 1);
    expect(result).toMatchObject({
      answers: 6,
      answered: 5,
      // "ok" and "unknown": an honest "not in the portfolio" is still helpful.
      helpful: 2,
      funnel: { offered: 2, confirmed: 1, sent: 1 },
      rated: { up: 1, down: 1 },
      helpfulRate: 0.4,
      thumbsUpRate: 0.5,
      unknownRate: 0.2,
      rephraseRate: 0,
    });
    expect(result.costPerAnswered).toBeCloseTo(0.002);
    expect(result.costPerHelpful).toBeCloseTo(0.005);
    expect(outcomes([], 0)).toMatchObject({ helpfulRate: null, costPerHelpful: null });
  });

  it("reads what the browsers saw: times beside the server's, shares of what applies, the 👎's reasons (visitor plan V2)", () => {
    const rows = [
      row("a", {
        signals: { v: 1, shownMs: 900, doneMs: 3_000, followups: 1, citations: 2, copies: 1 },
        ttftMs: 700,
        followupsOffered: true,
        cited: true,
      }),
      row("b", {
        signals: { v: 1, shownMs: 4_000, doneMs: 9_000, stopped: true },
        ttftMs: 3_500,
        followupsOffered: true,
        cited: true,
        feedback: -1,
        downReason: "wrong",
      }),
      // Asked again after a failure; no follow-ups offered, nothing cited.
      row("c", { signals: { v: 1, doneMs: 1_000, retries: 1 }, ttftMs: null }),
      // Its browser never reported: in no share, but its 👎 still counts.
      row("d", { feedback: -1 }),
      row("e", { feedback: -1, downReason: "a code from a newer terminal" }),
    ];
    expect(browserView(rows)).toEqual({
      reported: 3,
      shownP50Ms: 900,
      shownP95Ms: 4_000,
      serverP50Ms: 700,
      serverP95Ms: 3_500,
      stopRate: 1 / 3,
      copyRate: 1 / 3,
      // Of the two that offered follow-ups, one was clicked; of the two citing, one was followed.
      followupRate: 0.5,
      citationRate: 0.5,
      retried: 1,
      downReasons: { wrong: 1, unanswered: 0, length: 0, none: 2 },
    });
    expect(browserView([])).toMatchObject({
      reported: 0,
      shownP50Ms: null,
      stopRate: null,
      followupRate: null,
    });
    // Nearest rank (moved here from the router's report).
    expect(percentile([300, 100, 200], 0.5)).toBe(200);
  });

  it("rotates the primary metric once it moved less than a point in two weekly reviews", () => {
    // The weekly reviews are the complete weeks, across a year's end too.
    expect(completedWeeks(3, new Date("2026-09-30T12:00:00Z"))).toEqual([
      "2026-W37",
      "2026-W38",
      "2026-W39",
    ]);
    expect(completedWeeks(2, new Date("2026-01-07T12:00:00Z"))).toEqual(["2025-W52", "2026-W01"]);
    expect(shouldRotate([0.8, 0.805, 0.809])).toBe(true);
    expect(shouldRotate([0.7, 0.8, 0.805])).toBe(false);
    expect(shouldRotate([0.8, null, 0.8])).toBe(false);
    expect(shouldRotate([0.8, 0.8])).toBe(false);

    const rows = [
      row("w39", { createdAt: new Date("2026-09-22T10:00:00Z") }),
      row("w40", { createdAt: new Date("2026-09-29T10:00:00Z"), flags: ["uncited"] }),
    ];
    expect(weeklyValues(rows, "helpfulRate", ["2026-W38", "2026-W39", "2026-W40"])).toEqual([
      { week: "2026-W38", value: null },
      { week: "2026-W39", value: 1 },
      { week: "2026-W40", value: 0 },
    ]);
  });
});
