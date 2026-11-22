import { describe, expect, it } from "vitest";

import {
  answerFacts,
  attemptWords,
  cacheDays,
  cacheShare,
  checkLabel,
  checkTone,
  cost,
  dayRows,
  droppedRate,
  finishWords,
  happenedWords,
  passedOverSentence,
  reasonLabel,
  refusalsByDay,
  refusalTotals,
  shareOf,
  stepSentence,
  toolOutcomeLabel,
  toolTone,
} from "./answer-trace";
import type { AnswersRow, ConversationRow, TraceStep } from "./assistant-types";

const step: TraceStep = {
  model: "gemini-3.5-flash-lite",
  answerOnly: false,
  ttftMs: 1234,
  tokens: { input: 12_000, cached: 9000, output: 80, thoughts: 0 },
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

function answer(overrides: Partial<ConversationRow>): ConversationRow {
  return {
    id: "m_a0000001",
    createdAt: "2026-11-22T10:00:00Z",
    session: "3f9a2c01b7",
    locale: "en",
    route: "lite",
    question: "What has he shipped with RAG?",
    answer: "Atlas.",
    citedIds: [],
    droppedCitations: [],
    toolCalls: [],
    model: "gemini-flash",
    attempts: [],
    ttftMs: 820,
    totalMs: 2900,
    tokens: { input: 12_345, cached: 9876, output: 456, thoughts: 0 },
    usd: 0.0079,
    finishReason: "stop",
    promptVersion: "ask-2026-11-02.1",
    trace: null,
    corpusKey: null,
    checks: null,
    feedback: null,
    ...overrides,
  };
}

describe("answer traces", () => {
  it("says in a sentence who answered a step, how fast, what it read and wrote, how it ended", () => {
    expect(stepSentence(step)).toBe(
      "gemini-3.5-flash-lite: first word after 1.2 s, 12,000 tokens read (75 % from the cache), 80 written, then it called tools.",
    );
    expect(
      stepSentence({ ...step, model: null, ttftMs: null, tokens: null, finishReason: null }),
    ).toBe("No model could answer.");
    expect(stepSentence({ ...step, answerOnly: true, tokens: null, finishReason: "stop" })).toBe(
      "gemini-3.5-flash-lite: answering without tools, first word after 1.2 s, then it finished.",
    );
  });

  it("names the models a step passed over and why, or nothing", () => {
    expect(passedOverSentence(step)).toBeNull();
    expect(
      passedOverSentence({
        ...step,
        passedOver: [
          { model: "gemini-3.5-flash-lite", outcome: "rate-limited", ms: 120 },
          { model: "gemma", outcome: "skipped-open", ms: 0 },
        ],
      }),
    ).toBe(
      "Passed over first: gemini-3.5-flash-lite was rate-limited after 0.1 s; gemma was paused after failures.",
    );
  });

  it("says how an answer ended and what a model's attempt did, and keeps a code it does not know", () => {
    expect(finishWords("error:timeout")).toBe("failed: it timed out");
    expect(finishWords("aborted")).toBe("was stopped by the visitor");
    expect(finishWords("unknown")).toBe("ended (unknown)");
    expect(attemptWords("skipped-context")).toBe("had no room for the request");
    expect(attemptWords("constructor")).toBe("constructor");
  });

  it("gives an answer's facts in sentences, and the models tried when there were several", () => {
    expect(answerFacts(answer({}))).toEqual([
      "Asked in English, session 3f9a2c01b7, on the lite route, prompt ask-2026-11-02.1.",
      "Answered in 2.9 s, its first word after 0.8 s: 12,345 tokens read (80 % from the cache), 456 written, $0.0079.",
    ]);
    const tried = answerFacts(
      answer({
        locale: "de",
        ttftMs: null,
        attempts: [
          { model: "gemini-pro", outcome: "timeout", ms: 6000 },
          { model: "gemini-flash", outcome: "ok", ms: 2100 },
        ],
      }),
    );
    expect(tried[0]).toMatch(/^Asked in German/);
    expect(tried[1]).toMatch(/^Answered in 2\.9 s: /);
    expect(tried[2]).toBe(
      "Models tried: gemini-pro timed out after 6.0 s; gemini-flash answered after 2.1 s.",
    );
  });

  it("says what happened to an answer, worst first, or nothing", () => {
    expect(happenedWords(answer({}))).toBeNull();
    expect(
      happenedWords(
        answer({
          finishReason: "error:unavailable",
          feedback: -1,
          checks: { v: 1, flags: ["uncited"] },
          droppedCitations: ["project:nebula@de"],
        }),
      ),
    ).toBe("Failed: no model was available, thumbs down, uncited, 1 invented citation removed");
    expect(happenedWords(answer({ feedback: 1 }))).toBe("Thumbs up");
    // The check's flag is the count of those removed, said once.
    expect(
      happenedWords(
        answer({
          checks: { v: 1, flags: ["invented-citation"] },
          droppedCitations: ["a@en", "b@en"],
        }),
      ),
    ).toBe("2 invented citations removed");
    expect(
      happenedWords(
        answer({
          route: "match",
          trace: {
            v: 1,
            steps: [],
            match: {
              kind: "role",
              items: [
                { text: "a", status: "yes" },
                { text: "b", status: "partly", downgraded: true },
                { text: "c", status: null },
              ],
            },
          },
        }),
      ),
    ).toBe("Match: role, 2 rows, 1 taken back");
  });

  it("writes an answer's cost in dollars to the hundredth of a cent", () => {
    expect(cost(0.0079)).toBe("$0.0079");
    expect(cost(0.00002)).toBe("$0.00002");
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
      day({ day: "2026-09-29", primaryInput: 10_000, primaryCached: 8000 }),
      day({ day: "2026-09-30", primaryInput: 10_000, primaryCached: 1000 }),
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
      // A visitor's forget (visitor plan V14) is counted beside the refusals, never as one.
      { day: "2026-09-30", kind: "forgotten", count: 3 },
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
    expect(checkLabel("injection-attempt")).toBe("injection attempt");
    expect(checkLabel("repaired")).toBe("repaired: no words at first");
    expect(checkLabel("ungrounded-figure")).toBe("ungrounded figure");
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
          primaryInput: 1000,
          primaryCached: 900,
        }),
        day({
          day: "2026-09-30",
          answers: 2,
          withDropped: 1,
          primaryInput: 1000,
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

describe("review queue reasons", () => {
  it("says each in words: a check, the nightly judge, people as they are", () => {
    expect(reasonLabel("judge:unfaithful")).toBe("judged unfaithful");
    expect(reasonLabel("check:uncited")).toBe(checkLabel("uncited"));
    expect(reasonLabel("thumbs down")).toBe("thumbs down");
  });

  it("says the visitor's own signals: a thumbs-down's reason, a stop (visitor plan V2)", () => {
    expect(reasonLabel("thumbs down:wrong")).toBe("thumbs down: wrong or made up");
    expect(reasonLabel("thumbs down:unanswered")).toBe("thumbs down: didn't answer the question");
    expect(reasonLabel("thumbs down:length")).toBe("thumbs down: too long or too short");
    // A code this admin does not know yet still reads as a thumbs-down.
    expect(reasonLabel("thumbs down:other")).toBe("thumbs down");
    expect(reasonLabel("stopped")).toBe("stopped mid-answer");
  });
});
