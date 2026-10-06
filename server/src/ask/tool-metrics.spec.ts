import { describe, expect, it } from "vitest";

import { redact } from "./log.js";
import { measureTools, type ToolMetricsRow } from "./tool-metrics.js";
import type { AnswerTrace, TraceTool } from "./trace.js";

/** Plan phase 21: each tool's calls, how they ended, and whether their documents were cited. */

const tool = (name: string, outcome: TraceTool["outcome"], extra: Partial<TraceTool> = {}) =>
  ({ name, input: "{}", outcome, resultChars: 10, ...extra }) satisfies TraceTool;

const answer = (tools: TraceTool[], citedIds: string[] = []): ToolMetricsRow => ({
  trace: {
    v: 1,
    steps: [
      {
        model: "m",
        answerOnly: false,
        ttftMs: 1,
        tokens: null,
        finishReason: "stop",
        passedOver: [],
        tools,
      },
    ],
  } satisfies AnswerTrace,
  citedIds,
});

describe("measureTools", () => {
  it("counts calls per answer, the outcomes, and the citations their documents led to", () => {
    const metrics = measureTools([
      answer(
        [
          tool("search_portfolio", "ok", { hits: ["project:atlas@en", "post:a@en"] }),
          tool("get_document", "ok", { input: JSON.stringify({ id: "project:atlas@de" }) }),
        ],
        // Cited in the other language: the same document.
        ["project:atlas@en"],
      ),
      answer([
        tool("search_portfolio", "no_hits"),
        tool("search_portfolio", "duplicate"),
        tool("get_document", "not_found", { input: JSON.stringify({ id: "x@en" }) }),
        tool("get_document", "budget_exhausted"),
      ]),
      answer([tool("get_resume", "ok"), tool("suggest_followups", "ok")], ["cv@de"]),
      // An answer without a trace (before plan phase 5) is not counted.
      { trace: null, citedIds: [] },
    ]);
    expect(metrics.answers).toBe(3);
    const byName = Object.fromEntries(metrics.tools.map((t) => [t.name, t]));
    expect(metrics.tools.map((t) => t.name)).toEqual([
      "get_document",
      "search_portfolio",
      "get_resume",
      "suggest_followups",
    ]);
    expect(byName["search_portfolio"]).toMatchObject({
      calls: 3,
      callsPerAnswer: 1,
      outcomes: { ok: 1, no_hits: 1, duplicate: 1 },
      // One search returned documents, and the answer cited one of them.
      citedAfter: 1,
    });
    expect(byName["get_document"]).toMatchObject({
      calls: 3,
      outcomes: { ok: 1, not_found: 1, budget_exhausted: 1 },
      citedAfter: 1,
    });
    expect(byName["get_resume"]).toMatchObject({ calls: 1, citedAfter: 1 });
    // A tool that returns no documents has no citation rate.
    expect(byName["suggest_followups"]!.citedAfter).toBeNull();
    expect(measureTools([])).toEqual({ answers: 0, tools: [] });
  });

  it("matches a fetched id the trace redacted back to the document cited", () => {
    const faq = "faq:c9d0e1f2-a1b2-4c3d-8e9f-000000000003";
    // The trace keeps inputs redacted (log.ts): the id's long digit run is gone.
    const input = redact(JSON.stringify({ id: `${faq}@en` }));
    expect(input).toContain("[number]");
    const fetched = (cited: string[]) =>
      measureTools([answer([tool("get_document", "ok", { input })], cited)]).tools[0]!.citedAfter;
    expect(fetched([`${faq}@de`])).toBe(1);
    expect(fetched(["faq:c9d0e1f2-a1b2-4c3d-8e9f-other@en"])).toBe(0);
  });
});
