import { describe, expect, it } from "vitest";

import { answerTrace } from "./answer-trace";
import type { AskMessage } from "./ask-types";

const message = (parts: unknown[], metadata: AskMessage["metadata"]): AskMessage =>
  ({ id: "a1", role: "assistant", parts, metadata }) as AskMessage;

describe("answerTrace", () => {
  it("takes the route, model, timings, retrieval tools, sources and cache share", () => {
    const trace = answerTrace(
      "What did he build?",
      message(
        [
          { type: "tool-search_portfolio", toolCallId: "1", state: "output-available" },
          { type: "tool-get_document", toolCallId: "2", state: "output-available" },
          { type: "tool-search_portfolio", toolCallId: "3", state: "output-available" },
          { type: "tool-navigate", toolCallId: "4", state: "output-available" },
          { type: "text", text: "He built…" },
          { type: "source-url", sourceId: "project:a@en", url: "/en/work/a" },
          { type: "source-url", sourceId: "project:b@en", url: "/en/work/b" },
        ],
        {
          model: "gemini-3.5-flash-lite",
          route: "deep",
          fallback: true,
          ttftMs: 640,
          totalMs: 1830,
          tokens: { input: 1000, cached: 875, output: 120 },
        },
      ),
    );
    expect(trace).toEqual({
      question: "What did he build?",
      route: "deep",
      escalation: null,
      model: "gemini-3.5-flash-lite",
      fallback: true,
      ttftMs: 640,
      totalMs: 1830,
      tools: ["search_portfolio", "get_document"],
      // Without a receipt (an older server), every retrieval step the answer showed.
      lookups: 3,
      sources: 2,
      removed: 0,
      cachedPct: 88,
    });
  });

  it("leaves out what the answer did not report", () => {
    expect(answerTrace("hi", message([{ type: "text", text: "Hello" }], undefined))).toEqual({
      question: "hi",
      route: null,
      escalation: null,
      model: null,
      fallback: false,
      ttftMs: null,
      totalMs: null,
      tools: [],
      lookups: 0,
      sources: 0,
      removed: 0,
      cachedPct: null,
    });
  });

  it("takes the lookups, the move to deep and the removed references from the receipt (visitor plan V12)", () => {
    const trace = answerTrace(
      "Atlas or Borealis?",
      message([{ type: "tool-get_document", toolCallId: "1", state: "output-available" }], {
        route: "deep",
        receipt: { lookups: 2, sources: 1, removed: 1, escalation: "projects-fetched" },
      }),
    );
    expect(trace).toMatchObject({ escalation: "projects-fetched", lookups: 2, removed: 1 });
    // A code this terminal does not know is no move it can name.
    const odd = answerTrace(
      "x",
      message([], {
        receipt: { lookups: 0, sources: 0, removed: 0, escalation: "toString" as never },
      }),
    );
    expect(odd.escalation).toBeNull();
  });
});
