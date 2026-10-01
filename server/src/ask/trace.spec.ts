import { describe, expect, it } from "vitest";

import type { ModelCall, Trace } from "./models/fallback.js";
import type { RecordedStep } from "./stream-transforms.js";
import { buildAnswerTrace } from "./trace.js";

function call(model: string, overrides: Partial<ModelCall> = {}): ModelCall {
  return {
    model,
    answerOnly: false,
    ttftMs: 400,
    usage: {
      inputTokens: { total: 1_000, noCache: 400, cacheRead: 600, cacheWrite: 0 },
      outputTokens: { total: 50, text: 50, reasoning: 0 },
    },
    finishReason: "stop",
    ...overrides,
  };
}

describe("buildAnswerTrace", () => {
  it("gives each step its model, tokens, the models passed over, and its tools", () => {
    const trace: Trace = {
      startedAt: 0,
      firstTokenAt: 400,
      attempts: [
        { model: "gemini-3.5-flash-lite", outcome: "rate-limited", ms: 120, error: "429" },
        { model: "nemotron", outcome: "ok", ms: 900 },
        { model: "nemotron", outcome: "ok", ms: 700 },
      ],
      calls: [call("nemotron", { finishReason: "tool-calls" }), call("nemotron")],
    };
    const recorded: RecordedStep[] = [
      {
        finishReason: "tool-calls",
        tools: [
          {
            id: "t1",
            name: "get_document",
            input: { id: "project:nebula@en" },
            outcome: "not_found",
            resultChars: 48,
          },
          {
            id: "t2",
            name: "search_portfolio",
            input: { query: "rag" },
            outcome: "ok",
            resultChars: 900,
          },
        ],
      },
      { finishReason: "stop", tools: [] },
    ];

    expect(buildAnswerTrace(recorded, trace)).toEqual({
      v: 1,
      steps: [
        {
          model: "nemotron",
          answerOnly: false,
          ttftMs: 400,
          tokens: { input: 1_000, cached: 600, output: 50, thoughts: 0 },
          finishReason: "tool-calls",
          passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "rate-limited", ms: 120 }],
          tools: [
            {
              name: "get_document",
              input: '{"id":"project:nebula@en"}',
              outcome: "not_found",
              resultChars: 48,
            },
            { name: "search_portfolio", input: '{"query":"rag"}', outcome: "ok", resultChars: 900 },
          ],
        },
        expect.objectContaining({ model: "nemotron", passedOver: [], tools: [] }),
      ],
    });
  });

  it("redacts tool input and cuts it to 300 characters", () => {
    const summary = `Jane (jane@example.com, +49 170 1234567) wants to hire him. ${"x".repeat(400)}`;
    const trace: Trace = {
      startedAt: 0,
      firstTokenAt: 1,
      attempts: [{ model: "m", outcome: "ok", ms: 1 }],
      calls: [call("m")],
    };
    const recorded: RecordedStep[] = [
      {
        finishReason: "tool-calls",
        tools: [
          { id: "t", name: "handoff_contact", input: { summary }, outcome: "ok", resultChars: 40 },
        ],
      },
    ];
    const input = buildAnswerTrace(recorded, trace).steps[0]!.tools[0]!.input;
    expect(input).toContain("[email]");
    expect(input).toContain("[number]");
    expect(input).not.toContain("jane@example.com");
    expect(input).toHaveLength(300);
  });

  it("marks a tool whose result never came as cut off", () => {
    const trace: Trace = {
      startedAt: 0,
      firstTokenAt: 1,
      attempts: [{ model: "m", outcome: "ok", ms: 1 }],
      calls: [call("m", { finishReason: null })],
    };
    const recorded: RecordedStep[] = [
      {
        finishReason: null,
        tools: [{ id: "t", name: "search_portfolio", input: {}, outcome: null, resultChars: 0 }],
      },
    ];
    expect(buildAnswerTrace(recorded, trace).steps[0]!.tools[0]!.outcome).toBe("cut-off");
  });

  it("adds the step no model could answer, with what was tried", () => {
    const trace: Trace = {
      startedAt: 0,
      firstTokenAt: 1,
      attempts: [
        { model: "a", outcome: "ok", ms: 5 },
        { model: "a", outcome: "server-error", ms: 30, error: "500" },
        { model: "b", outcome: "skipped-open", ms: 0 },
      ],
      calls: [call("a", { finishReason: "tool-calls" })],
    };
    const steps = buildAnswerTrace([{ finishReason: "tool-calls", tools: [] }], trace).steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toEqual({
      model: null,
      answerOnly: false,
      ttftMs: null,
      tokens: null,
      finishReason: null,
      passedOver: [
        { model: "a", outcome: "server-error", ms: 30 },
        { model: "b", outcome: "skipped-open", ms: 0 },
      ],
      tools: [],
    });
  });

  it("is empty when nothing was tried", () => {
    const trace: Trace = { startedAt: 0, firstTokenAt: null, attempts: [], calls: [] };
    expect(buildAnswerTrace([], trace)).toEqual({ v: 1, steps: [] });
  });
});
