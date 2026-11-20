import { describe, expect, it } from "vitest";

import type { AssistantHealth, BreakerRow, SpendToday } from "./assistant-types";
import { joiner, modelLines, spendRows, stateLine, switchedOff, usd } from "./now";
import { typedAt } from "./recovery.service";

function health(overrides: Partial<AssistantHealth> = {}): AssistantHealth {
  return {
    state: { state: "ok", deepAllowed: true, spentUsd: 0.42, budgetUsd: 2 },
    inFlight: 0,
    breakers: [],
    last24h: { answers: 12, failures: 0, fallbackRate: 0, models: [] },
    corpus: null,
    ...overrides,
  };
}

function breaker(model: string, overrides: Partial<BreakerRow> = {}): BreakerRow {
  return {
    model,
    state: "closed",
    openUntil: null,
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    p50TtftMs: null,
    ...overrides,
  };
}

describe("Now's state line", () => {
  it("says it answers, and the last 24 hours in words", () => {
    expect(stateLine(health())).toEqual({
      tone: "ok",
      words: "Answering. 12 answers in the last 24 hours: none failed, 0 % from a fallback model.",
    });
    expect(
      stateLine(health({ last24h: { answers: 0, failures: 0, fallbackRate: 0, models: [] } }))
        .words,
    ).toBe("Answering. No answers in the last 24 hours.");
  });

  it("warns of paused models and failed answers, and says what streams and that the deep model is off", () => {
    const line = stateLine(
      health({
        state: { state: "ok", deepAllowed: false, spentUsd: 1.7, budgetUsd: 2 },
        inFlight: 1,
        breakers: [breaker("a", { state: "open" }), breaker("b")],
        last24h: { answers: 1, failures: 1, fallbackRate: 0.104, models: [] },
      }),
    );
    expect(line).toEqual({
      tone: "warn",
      words:
        "Answering, one model paused. 1 answer in the last 24 hours: 1 failed, 10 % from a fallback model. " +
        "1 answer streaming now. The deep model is off: over 80 % of the budget is spent, or Settings turned it off.",
    });
    const two = stateLine(
      health({ breakers: [breaker("a", { state: "open" }), breaker("b", { state: "open" })] }),
    );
    expect(two.words.startsWith("Answering, 2 models paused.")).toBe(true);
  });

  it("says why it rests or is off, in words, never as a code", () => {
    expect(
      stateLine(health({ state: { state: "resting", spentUsd: 2, budgetUsd: 2, line: "budget" } })),
    ).toEqual({
      tone: "warn",
      words:
        "Resting: today's budget of $2.00 is spent. 12 answers in the last 24 hours: none failed, 0 % from a fallback model.",
    });
    expect(stateLine(health({ state: { state: "off", reason: "disabled_by_admin" } }))).toEqual({
      tone: "off",
      words:
        "Off: switched off in Settings. 12 answers in the last 24 hours: none failed, 0 % from a fallback model.",
    });
  });
});

describe("Now's spend", () => {
  const spend: SpendToday = {
    totalUsd: 0.45,
    budgetUsd: 2,
    publicReserve: 0.5,
    reserveLineUsd: 1,
    features: [
      { feature: "terminal", spentUsd: 0.12, capUsd: null, switchedOn: null, state: "ok" },
      { feature: "match", spentUsd: 0, capUsd: 0.1, switchedOn: false, state: "off" },
      { feature: "eval", spentUsd: 0.3, capUsd: 0.3, switchedOn: null, state: "cap" },
      { feature: "copilot", spentUsd: 0.004, capUsd: null, switchedOn: true, state: "ok" },
      { feature: "judge", spentUsd: 0, capUsd: 0, switchedOn: true, state: "cap" },
      { feature: "agent", spentUsd: 0, capUsd: null, switchedOn: false, state: "off" },
    ],
  };

  it("draws a bar per feature that spent today or stopped at its cap, on the day's scale", () => {
    expect(spendRows(spend)).toEqual([
      {
        feature: "eval",
        label: "Eval runs",
        spentUsd: 0.3,
        share: 0.15,
        stopped: "stopped at its cap",
      },
      {
        feature: "terminal",
        label: "Visitors' assistant",
        spentUsd: 0.12,
        share: 0.06,
        stopped: null,
      },
      { feature: "copilot", label: "Copilot", spentUsd: 0.004, share: 0.002, stopped: null },
      {
        feature: "judge",
        label: "Judge runs",
        spentUsd: 0,
        share: 0,
        stopped: "stopped at its cap",
      },
    ]);
  });

  it("names the switched-off features, and shows a sliver of a cent as spent", () => {
    expect(switchedOff(spend)).toEqual(["Match a brief", "Admin agents"]);
    expect([usd(0.004), usd(0), usd(0.4249)]).toEqual(["<$0.01", "$0.00", "$0.42"]);
  });
});

describe("Now's models, in words", () => {
  const at = new Date(Date.now() - 60_000).toISOString();
  const until = new Date(Date.now() + 240_000).toISOString();

  it("puts the paused model first, with its failures, its times and the provider's own words", () => {
    const lines = modelLines({
      breakers: [
        breaker("gemini-flash-lite"),
        breaker("gemini-3.7-flash", {
          state: "open",
          consecutiveFailures: 3,
          lastFailureAt: at,
          openUntil: until,
          lastError: "You exceeded your current quota.",
        }),
        breaker("qwen3-32b:free", { state: "half-open", lastError: "503 high demand" }),
      ],
      last24h: {
        answers: 9,
        failures: 0,
        fallbackRate: 0,
        models: [{ model: "gemini-flash-lite", answers: 9, p50TtftMs: 420, p95TtftMs: 1250 }],
      },
    });
    expect(lines).toEqual([
      {
        model: "gemini-3.7-flash",
        tone: "warn",
        words: `paused after 3 failures at ${typedAt(Date.parse(at))}, until ${typedAt(Date.parse(until))}`,
        error: "You exceeded your current quota.",
      },
      {
        model: "qwen3-32b:free",
        tone: "trying",
        words: "trying again: the next question tests it",
        error: "503 high demand",
      },
      {
        model: "gemini-flash-lite",
        tone: "ok",
        words: "answering; first word in 0.4 s, 1.3 s for the slowest 1 in 20",
        error: null,
      },
    ]);
  });

  it("says a model that answers but failed lately, and keeps its error", () => {
    const [line] = modelLines({
      breakers: [breaker("m", { consecutiveFailures: 1, lastFailureAt: at, lastError: "timeout" })],
      last24h: { answers: 0, failures: 0, fallbackRate: 0, models: [] },
    });
    expect(line).toEqual({
      model: "m",
      tone: "warn",
      words: `answering; failed 1 time in a row, last at ${typedAt(Date.parse(at))}`,
      error: "timeout",
    });
  });
});

/** The sentence Now writes around its links. */
const join = (items: string[]) => items.map((item, i) => item + joiner(i, items.length)).join("");

describe("Now's queue counts, as one sentence of links", () => {
  it("joins them as a, b and c, with a full stop", () => {
    expect(join(["a"])).toBe("a.");
    expect(join(["a", "b"])).toBe("a and b.");
    expect(join(["a", "b", "c"])).toBe("a, b and c.");
  });
});
