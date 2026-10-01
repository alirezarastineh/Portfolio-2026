import { describe, expect, it } from "vitest";

import {
  cacheDays,
  cacheShare,
  checkLabel,
  checkTone,
  dayRows,
  droppedRate,
  shareOf,
  passedOverLine,
  refusalsByDay,
  refusalTotals,
  stepLine,
  toolOutcomeLabel,
  toolTone,
} from "./answer-trace";
import type { AnswersRow, TraceStep } from "./assistant-types";

const step: TraceStep = {
  model: "gemini-3.5-flash-lite",
  answerOnly: false,
  ttftMs: 1_234,
  tokens: { input: 12_000, cached: 9_000, output: 80, thoughts: 0 },
  finishReason: "tool-calls",
  passedOver: [],
  tools: [],
};

function day(overrides: Partial<AnswersRow>): AnswersRow {
  return {
    day: "2026-09-30",
    answers: 0,
    up: 0,
    down: 0,
    withDropped: 0,
    flagged: 0,
    primaryInput: 0,
    primaryCached: 0,
    ...overrides,
  };
}

describe("answer traces", () => {
  it("says in one line who answered a step, how fast, and what it cost in tokens", () => {
    expect(stepLine(step)).toBe(
      "gemini-3.5-flash-lite · 1,234 ms to first token · 12,000 in (75 % cached) · 80 out · tool-calls",
    );
    expect(stepLine({ ...step, model: null, ttftMs: null, tokens: null, finishReason: null })).toBe(
      "no model could answer",
    );
    expect(stepLine({ ...step, answerOnly: true, tokens: null })).toContain("answer-only");
  });

  it("lists the models a step passed over, or nothing", () => {
    expect(passedOverLine(step)).toBeNull();
    expect(
      passedOverLine({
        ...step,
        passedOver: [
          { model: "gemini-3.5-flash-lite", outcome: "rate-limited", ms: 120 },
          { model: "gemma", outcome: "skipped-open", ms: 0 },
        ],
      }),
    ).toBe("gemini-3.5-flash-lite rate-limited (120 ms) → gemma skipped-open (0 ms)");
  });

  it("colours tool outcomes: refusals and errors bad, empty results worth a look", () => {
    expect(toolTone("ok")).toBe("ok");
    expect(toolTone("not_allowed")).toBe("bad");
    expect(toolTone("error")).toBe("bad");
    expect(toolTone("no_hits")).toBe("warn");
    expect(toolTone("not_found")).toBe("warn");
    expect(toolTone("cut-off")).toBe("warn");
    expect(toolOutcomeLabel("not_allowed")).toBe("not allowed");
  });
});

describe("assistant signals", () => {
  it("flags days when the primary model's cache hits fall under 50 %", () => {
    const rows = [
      day({ day: "2026-09-29", primaryInput: 10_000, primaryCached: 8_000 }),
      day({ day: "2026-09-30", primaryInput: 10_000, primaryCached: 1_000 }),
      day({ day: "2026-09-28", primaryInput: 0 }),
    ];
    expect(cacheDays(rows)).toEqual([
      { day: "2026-09-30", share: 0.1, warn: true },
      { day: "2026-09-29", share: 0.8, warn: false },
      { day: "2026-09-28", share: null, warn: false },
    ]);
    expect(cacheShare(rows)).toBeCloseTo(0.45);
    expect(cacheShare([day({})])).toBeNull();
  });

  it("totals refusals per day and per kind, most frequent first", () => {
    const rows = [
      { day: "2026-09-29", kind: "busy", count: 1 },
      { day: "2026-09-30", kind: "honeypot", count: 2 },
      { day: "2026-09-30", kind: "rate_limited", count: 5 },
    ];
    expect(refusalsByDay(rows)).toEqual([
      { day: "2026-09-30", total: 7, kinds: "rate_limited 5 · honeypot 2" },
      { day: "2026-09-29", total: 1, kinds: "busy 1" },
    ]);
    expect(refusalTotals(rows)).toEqual([
      { kind: "rate_limited", count: 5 },
      { kind: "honeypot", count: 2 },
      { kind: "busy", count: 1 },
    ]);
  });

  it("gives the share of answers the checks flagged, and names each flag", () => {
    expect(
      shareOf([day({ answers: 4, flagged: 1 }), day({ answers: 6, flagged: 2 })], "flagged"),
    ).toEqual({ answers: 10, count: 3, rate: 0.3 });
    expect(checkLabel("invented-citation")).toBe("invented citation");
    expect(checkLabel("something-new")).toBe("something-new");
    expect(checkTone("leak")).toBe("bad");
    expect(checkTone("degraded")).toBe("warn");
  });

  it("merges answers, spend and refusals into one row per day, newest first", () => {
    const rows = dayRows({
      answers: [
        day({
          day: "2026-09-29",
          answers: 4,
          up: 1,
          flagged: 1,
          primaryInput: 1_000,
          primaryCached: 900,
        }),
        day({
          day: "2026-09-30",
          answers: 2,
          withDropped: 1,
          primaryInput: 1_000,
          primaryCached: 100,
        }),
      ],
      models: [
        {
          day: "2026-09-30",
          model: "a",
          requests: 1,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          thoughtTokens: 0,
          usd: 0.25,
        },
        {
          day: "2026-09-30",
          model: "b",
          requests: 1,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          thoughtTokens: 0,
          usd: 0.5,
        },
      ],
      // A day with refusals and nothing else still gets its row.
      guardEvents: [{ day: "2026-09-28", kind: "rate_limited", count: 3 }],
    });
    expect(rows.map((r) => r.day)).toEqual(["2026-09-30", "2026-09-29", "2026-09-28"]);
    expect(rows[0]).toMatchObject({
      answers: 2,
      withDropped: 1,
      usd: 0.75,
      cache: 0.1,
      cacheWarn: true,
    });
    expect(rows[1]).toMatchObject({ answers: 4, up: 1, flagged: 1, cache: 0.9, cacheWarn: false });
    expect(rows[2]).toMatchObject({
      answers: 0,
      refused: 3,
      refusedKinds: "rate_limited 3",
      cache: null,
    });
    // An older API's usage (no refusals, no new fields) still reads.
    expect(dayRows({ answers: [], models: [] })).toEqual([]);
  });

  it("gives the share of answers with an invented citation", () => {
    expect(
      droppedRate([day({ answers: 8, withDropped: 1 }), day({ answers: 2, withDropped: 1 })]),
    ).toEqual({ answers: 10, withDropped: 2, rate: 0.2 });
    expect(droppedRate([])).toEqual({ answers: 0, withDropped: 0, rate: 0 });
  });
});
