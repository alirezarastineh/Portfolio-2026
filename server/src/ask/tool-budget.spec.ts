import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { FIXTURE_BASE, fixtureConfig } from "../test/ask-fixtures.js";
import { drain, finish, mockEntry, scripted, textTurn } from "../test/ask-models.js";
import { streamAnswer } from "./agent.js";
import type { CorpusDocument, CorpusKind } from "./corpus/build.js";
import { assembleCorpus } from "./corpus/index.js";
import { wrapVisitor } from "./prompt.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { ToolBudget } from "./tool-budget.js";
import { DOCUMENT_CALLS, DOCUMENT_CHARS, FETCH_CLIP, NOTES } from "./tool-defs.js";

/** Plan phase 21: duplicate suppression and the document envelope, per answer. */

describe("an answer's tool budget", () => {
  it("lets each search run once, however it is typed, its kinds included", () => {
    const budget = new ToolBudget();
    expect(budget.firstSearch("RAG evaluation")).toBe(true);
    expect(budget.firstSearch("  rag   EVALUATION ")).toBe(false);
    expect(budget.firstSearch("RAG evaluation", ["project"])).toBe(true);
    expect(budget.firstSearch("RAG evaluation", ["project"])).toBe(false);
    // The kinds in any order are the same search.
    expect(budget.firstSearch("x", ["post", "project"])).toBe(true);
    expect(budget.firstSearch("x", ["project", "post"])).toBe(false);
  });

  it("reads a document once, each cut at 12,000, at most four and 40,000 characters in all", () => {
    // A short document is read whole.
    expect(new ToolBudget().take("profile@en", 500)).toBe(500);

    const budget = new ToolBudget();
    expect(budget.hasRead("project:atlas@en")).toBe(false);
    expect(budget.take("project:atlas@en", 30_000)).toBe(FETCH_CLIP);
    expect(budget.hasRead("project:atlas@en")).toBe(true);
    expect(budget.take("post:a@en", 30_000)).toBe(FETCH_CLIP);
    expect(budget.take("post:b@en", 30_000)).toBe(FETCH_CLIP);
    // 36,000 read: the fourth is cut to what is left of the 40,000.
    expect(budget.take("post:c@en", 30_000)).toBe(4_000);
    expect(budget.spent()).toEqual({ calls: DOCUMENT_CALLS, chars: DOCUMENT_CHARS });
    // A fifth, however short, is past the envelope.
    expect(budget.take("profile@en", 10)).toBeNull();
    expect(budget.hasRead("profile@en")).toBe(false);
  });
});

// The real agent on a scripted model: the done-when's two paths.

const document = (id: string, kind: CorpusKind, text: string): CorpusDocument => ({
  id,
  kind,
  locale: "en",
  title: id,
  url: "/en",
  text,
});

const LONG = "Long case study. ".repeat(1_000);

const EXTRA: CorpusDocument[] = [
  document("cv@en", "cv", "Curriculum vitae: Alireza Rastineh, Berlin."),
  document("project:borealis@en", "project", "Borealis — analytics pipeline"),
  document("post:evals@en", "post", "How he evaluates retrieval."),
  document("project:long-a@en", "project", `A ${LONG}`),
  document("project:long-b@en", "project", `B ${LONG}`),
  document("project:long-c@en", "project", `C ${LONG}`),
  document("project:long-d@en", "project", `D ${LONG}`),
];

/** Several tool calls in one step, as a model may make them. */
function callsTurn(...calls: [id: string, tool: string, input: unknown][]) {
  return [
    { type: "stream-start", warnings: [] },
    ...calls.map(([toolCallId, toolName, input]) => ({
      type: "tool-call" as const,
      toolCallId,
      toolName,
      input: JSON.stringify(input),
    })),
    finish("tool-calls"),
  ] satisfies LanguageModelV4StreamPart[];
}

async function answerWith(turns: LanguageModelV4StreamPart[][]) {
  const config = fixtureConfig();
  const corpus = assembleCorpus(
    { ...FIXTURE_BASE, key: "budget", documents: [...FIXTURE_BASE.documents, ...EXTRA] },
    DEFAULT_SETTINGS,
    [],
    config,
  );
  const model = scripted(turns);
  const question = "Tell me everything about his work";
  const run = streamAnswer({
    messages: [{ role: "user", content: wrapVisitor(question, "en") }],
    question,
    locale: "en",
    language: "en",
    sessionId: "budget-session-000001",
    sessionHash: "budget",
    source: "eval",
    route: { route: "lite", reason: "test" },
    corpus,
    config,
    chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
    abortSignal: new AbortController().signal,
    persist: false,
  });
  await drain(run.stream);
  const outcome = await run.done;
  const outcomes = outcome.steps!.steps.map((step) => step.tools.map((tool) => tool.outcome));
  return { model, outcome, outcomes };
}

/** What the model was handed back for each tool call, by the call's id. */
function resultsSeen(call: LanguageModelV4CallOptions): Map<string, Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const message of call.prompt) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.output.type === "json") {
        seen.set(part.toolCallId, part.output.value as Record<string, unknown>);
      }
    }
  }
  return seen;
}

describe("the tools in an answer (scripted model)", () => {
  it("answer a repeated search or document with 'already provided', however it is asked", async () => {
    const { model, outcome, outcomes } = await answerWith([
      // The same search twice in one step, the second typed differently.
      callsTurn(
        ["s1", "search_portfolio", { query: "Atlas" }],
        ["s2", "search_portfolio", { query: "  atlas " }],
      ),
      // The same document by its full id and without its language; the CV both ways.
      callsTurn(
        ["d1", "get_document", { id: "project:atlas@en" }],
        ["d2", "get_document", { id: "project:atlas" }],
        ["d3", "get_resume", {}],
        ["d4", "get_document", { id: "cv@en" }],
      ),
      // A step later, the first search again; the same words for other kinds are a new search.
      callsTurn(
        ["s3", "search_portfolio", { query: "Atlas" }],
        ["s4", "search_portfolio", { query: "Atlas", kinds: ["project"] }],
      ),
      textTurn("Atlas is his retrieval assistant [^project:atlas@en]."),
    ]);

    expect(outcomes).toEqual([
      ["ok", "duplicate"],
      ["ok", "duplicate", "ok", "duplicate"],
      ["duplicate", "ok"],
      [],
    ]);
    const seen = resultsSeen(model.calls[3]!);
    expect(seen.get("s2")).toEqual({ duplicate: true, note: NOTES.alreadyProvided });
    expect(seen.get("d2")).toEqual({
      id: "project:atlas@en",
      duplicate: true,
      note: NOTES.alreadyProvided,
    });
    expect(seen.get("d4")).toEqual({ id: "cv@en", duplicate: true, note: NOTES.alreadyProvided });
    expect(seen.get("s3")).toEqual({ duplicate: true, note: NOTES.alreadyProvided });
    expect(seen.get("d1")).toMatchObject({ id: "project:atlas@en", title: "Atlas" });
    expect(outcome.citedIds).toEqual(["project:atlas@en"]);
  });

  it("stop at four documents: the fifth is budget_exhausted, a repeat still 'already provided'", async () => {
    const { model, outcomes } = await answerWith([
      callsTurn(
        ["d1", "get_document", { id: "profile@en" }],
        ["d2", "get_document", { id: "project:atlas@en" }],
        ["d3", "get_document", { id: "project:borealis@en" }],
        ["d4", "get_resume", {}],
        ["d5", "get_document", { id: "post:evals@en" }],
      ),
      callsTurn(["d6", "get_document", { id: "profile@en" }]),
      textTurn("He is based in Berlin [^profile@en]."),
    ]);

    expect(outcomes).toEqual([["ok", "ok", "ok", "ok", "budget_exhausted"], ["duplicate"], []]);
    const seen = resultsSeen(model.calls[2]!);
    expect(seen.get("d5")).toEqual({ error: "budget_exhausted", note: NOTES.budgetSpent });
    expect(seen.get("d6")).toMatchObject({ duplicate: true });
  });

  it("stop at 40,000 characters: long documents arrive cut, the last to what is left", async () => {
    const { model, outcomes } = await answerWith([
      callsTurn(
        ["l1", "get_document", { id: "project:long-a@en" }],
        ["l2", "get_document", { id: "project:long-b@en" }],
        ["l3", "get_document", { id: "project:long-c@en" }],
        // 36,000 characters read: the fourth gets the 4,000 left, and the envelope is spent.
        ["l4", "get_document", { id: "project:long-d@en" }],
        ["l5", "get_document", { id: "profile@en" }],
      ),
      textTurn("Four projects [^project:long-a@en]."),
    ]);

    expect(outcomes).toEqual([["ok", "ok", "ok", "ok", "budget_exhausted"], []]);
    const seen = resultsSeen(model.calls[1]!);
    const text = (id: string) => seen.get(id)!["text"] as string;
    expect(text("l1")).toHaveLength(FETCH_CLIP + 1);
    expect(text("l1").endsWith("…")).toBe(true);
    expect(text("l4")).toHaveLength(DOCUMENT_CHARS - 3 * FETCH_CLIP + 1);
    expect(text("l4").startsWith("D Long case study.")).toBe(true);
    expect(seen.get("l5")).toEqual({ error: "budget_exhausted", note: NOTES.budgetSpent });
  });

  it("is each answer's own: the next answer reads the same documents again", async () => {
    const first = await answerWith([
      callsTurn(["d1", "get_document", { id: "project:atlas@en" }]),
      textTurn("Atlas [^project:atlas@en]."),
    ]);
    // The CV the other way round too: by its id first, then as the CV.
    const second = await answerWith([
      callsTurn(
        ["d1", "get_document", { id: "project:atlas@en" }],
        ["d2", "get_document", { id: "cv@en" }],
        ["d3", "get_resume", {}],
      ),
      textTurn("Atlas [^project:atlas@en]."),
    ]);

    expect(first.outcomes).toEqual([["ok"], []]);
    expect(second.outcomes).toEqual([["ok", "ok", "duplicate"], []]);
    expect(resultsSeen(second.model.calls[1]!).get("d3")).toEqual({
      id: "cv@en",
      duplicate: true,
      note: NOTES.alreadyProvided,
    });
  });
});
