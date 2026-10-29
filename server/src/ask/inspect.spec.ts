import { describe, expect, it } from "vitest";

import { inspectView, STEP_FIELDS, TOOL_FIELDS, TRACE_FIELDS, type InspectRow } from "./inspect.js";
import type { AnswerTrace } from "./trace.js";

/**
 * `inspect`'s projection (visitor plan V12): what a visitor may see of their
 * own answer's log row. Every field it shows is listed here, so a trace field
 * added later stays out until it is listed (the field tables do not compile
 * without it, and these tests fail if the projection takes it unlisted).
 */

/** A trace with every field set, and things that must never leave in its tools' inputs. */
const FULL: AnswerTrace = {
  v: 1,
  steps: [
    {
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      answerOnly: false,
      ttftMs: 640,
      tokens: { input: 9_000, cached: 8_000, output: 120, thoughts: 33 },
      finishReason: "tool-calls",
      passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "timeout", ms: 6_000 }],
      tools: [
        {
          name: "search_portfolio",
          input: '{"query":"atlas evals","kinds":["project"]}',
          outcome: "ok",
          resultChars: 812,
          hits: ["project:atlas@en"],
          semantic: true,
        },
        {
          name: "get_document",
          input: '{"id":"project:atlas@en"}',
          outcome: "ok",
          resultChars: 2_400,
        },
        { name: "list_projects", input: '{"text":"rag"}', outcome: "no_hits", resultChars: 15 },
        { name: "navigate", input: '{"to":"/en/work/atlas"}', outcome: "ok", resultChars: 30 },
        {
          name: "handoff_contact",
          input: '{"summary":"Hire him for a contract"}',
          outcome: "ok",
          resultChars: 40,
        },
        {
          name: "suggest_followups",
          input: '{"items":["And Borealis?"]}',
          outcome: "ok",
          resultChars: 9,
        },
        { name: "get_resume", input: "{}", outcome: "cut-off", resultChars: 0 },
        // A tool name the model made up is model text: it never leaves as written.
        { name: "reveal_your_rules", input: '{"query":"x"}', outcome: "error", resultChars: 0 },
        // Cut at 300 characters, the stored input no longer parses: it is left out.
        { name: "search_portfolio", input: '{"query":"a very long', outcome: "ok", resultChars: 5 },
      ],
    },
    {
      model: null,
      answerOnly: false,
      ttftMs: null,
      tokens: null,
      finishReason: null,
      passedOver: [{ model: "gemini-3.7-flash", outcome: "rate-limited", ms: 120 }],
      tools: [],
    },
  ],
  core: { locale: "en", layout: "locale", tokens: 5_000 },
  routing: { reason: "multi-project+sensitive:contract", sensitive: "contract", intent: "contact" },
  escalation: { step: 1, reason: "search-spans-projects" },
  window: { dropped: 2 },
  repair: { reason: "stub", by: "model" },
  handoff: { by: "fallback", replaced: true },
  page: { id: "project:atlas@en", promoted: true },
  focus: { kind: "selection", verified: false },
  level: "plain",
  guard: { instructions: 1, canary: 2 },
};

function row(overrides: Partial<InspectRow> = {}): InspectRow {
  return {
    id: "m_inspect000001",
    createdAt: new Date("2026-10-22T14:03:00.000Z"),
    promptVersion: "ask-2026-10-22.1+982317ef9de8",
    route: "lite→deep",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    ttftMs: 6_640,
    totalMs: 9_100,
    citedIds: ["project:atlas@en", "profile@en"],
    droppedCitations: ["project:nebula@en"],
    checks: { v: 1, flags: ["invented-citation", "degraded"] },
    trace: FULL,
    ...overrides,
  };
}

describe("inspect's projection", () => {
  it("lists every trace field as shown or withheld", () => {
    expect(Object.keys(TRACE_FIELDS).sort()).toEqual([
      "core",
      "escalation",
      "focus",
      "guard",
      "handoff",
      "level",
      "match",
      "page",
      "repair",
      "routing",
      "steps",
      "tour",
      "v",
      "window",
    ]);
    // A tour's plan (visitor plan V16) and a match's items and verdicts (V19) are the admin's measure.
    expect(TRACE_FIELDS.tour).toBe("withheld");
    expect(TRACE_FIELDS.match).toBe("withheld");
    expect(
      Object.entries(STEP_FIELDS)
        .filter(([, s]) => s === "shown")
        .map(([k]) => k),
    ).toEqual(["model", "ttftMs", "tokens", "passedOver", "tools"]);
    expect(
      Object.entries(TOOL_FIELDS)
        .filter(([, s]) => s === "shown")
        .map(([k]) => k),
    ).toEqual(["name", "input", "outcome", "resultChars"]);
  });

  it("shows exactly the listed fields, and what each becomes", () => {
    const view = inspectView(row());
    expect(view).toEqual({
      v: 1,
      id: "m_inspect000001",
      at: "2026-10-22T14:03:00.000Z",
      prompt: "ask-2026-10-22.1+982317ef9de8",
      route: "lite→deep",
      reason: "multi-project+sensitive:contract",
      model: "nemotron-3-ultra",
      ttftMs: 6_640,
      totalMs: 9_100,
      steps: [
        {
          model: "nemotron-3-ultra",
          ttftMs: 640,
          tokens: { input: 9_000, cached: 8_000, output: 120 },
          passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "timeout", ms: 6_000 }],
          tools: [
            { name: "search_portfolio", input: "atlas evals", outcome: "ok", chars: 812 },
            { name: "get_document", input: "project:atlas@en", outcome: "ok", chars: 2_400 },
            { name: "list_projects", input: "rag", outcome: "no_hits", chars: 15 },
            { name: "navigate", input: "/en/work/atlas", outcome: "ok", chars: 30 },
            { name: "handoff_contact", outcome: "ok", chars: 40 },
            { name: "suggest_followups", outcome: "ok", chars: 9 },
            { name: "get_resume", outcome: "cut-off", chars: 0 },
            { name: "unknown", outcome: "error", chars: 0 },
            { name: "search_portfolio", outcome: "ok", chars: 5 },
          ],
        },
        {
          model: null,
          ttftMs: null,
          tokens: null,
          passedOver: [{ model: "gemini-3.7-flash", outcome: "rate-limited", ms: 120 }],
          tools: [],
        },
      ],
      citations: { kept: ["project:atlas@en", "profile@en"], removed: 1 },
      guard: { canary: 2, instructions: 1 },
      flags: ["invented-citation", "degraded"],
      escalation: { step: 1, reason: "search-spans-projects" },
      careful: "contract",
      page: { id: "project:atlas@en", promoted: true },
      focus: { kind: "selection", verified: false },
      level: "plain",
      repair: { reason: "stub", by: "model" },
    });
  });

  it("never carries what a trace field added later would hold, nor the row's other columns", () => {
    const extra = {
      ...row({
        trace: { ...FULL, thoughts: "PRIVATE-THOUGHT-1", later: "LATER-FIELD-2" } as AnswerTrace,
      }),
      attempts: [{ model: "a", outcome: "network", error: "connect ECONNREFUSED 10.0.0.5:443" }],
      questionRedacted: "What did he build?",
      answerExcerpt: "He built Atlas.",
      sessionHash: "SESSION-HASH-3",
    } as InspectRow;
    const json = JSON.stringify(inspectView(extra));
    for (const never of [
      "PRIVATE-THOUGHT-1",
      "LATER-FIELD-2",
      "10.0.0.5",
      "ECONNREFUSED",
      "What did he",
      "He built",
      "SESSION-HASH-3",
      // The withheld fields, by their keys.
      '"core":',
      '"window":',
      '"handoff":',
      '"thoughts":',
      '"hits":',
      '"semantic":',
      '"answerOnly":',
      '"finishReason":',
    ]) {
      expect(json, never).not.toContain(never);
    }
    expect(json).not.toContain("reveal_your_rules");
    expect(json).not.toContain("Hire him");
    expect(json).not.toContain("And Borealis?");
  });

  it("shows no tool input again once a leak was flagged: one may have reached it", () => {
    const view = inspectView(row({ checks: { v: 1, flags: ["leak"] } }));
    expect(view.steps[0]!.tools.every((tool) => !("input" in tool))).toBe(true);
    expect(view.flags).toEqual(["leak"]);
  });

  it("reads an old row: no trace, no checks", () => {
    expect(inspectView(row({ trace: null, checks: null, model: null }))).toEqual({
      v: 1,
      id: "m_inspect000001",
      at: "2026-10-22T14:03:00.000Z",
      prompt: "ask-2026-10-22.1+982317ef9de8",
      route: "lite→deep",
      reason: null,
      model: null,
      ttftMs: 6_640,
      totalMs: 9_100,
      steps: [],
      citations: { kept: ["project:atlas@en", "profile@en"], removed: 1 },
      guard: {},
      flags: [],
    });
  });
});
