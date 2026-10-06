import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import { fixtureConfig, twoProjectCorpus } from "../test/ask-fixtures.js";
import {
  drain,
  mockEntry,
  scripted,
  thinkingTurn,
  toolTurn,
  type ScriptedModel,
} from "../test/ask-models.js";
import { streamAnswer, type AnswerRequest } from "./agent.js";
import type { ModelEntry } from "./models/registry.js";
import { wrapVisitor } from "./prompt.js";

/**
 * Plan phase 23: thoughts for the admin's answers only. The playground and
 * the evals ask the model for them, keep them and stream them (the
 * playground shows them collapsed, a failed eval case keeps an excerpt); a
 * visitor's answer never asks for them, and drops any a model sends anyway.
 */

const THOUGHT = "The profile says Berlin; cite it.";
const ANSWER = "He is based in Berlin [^profile@en].";

/** A Gemini entry as the registry builds it: thinking, its thoughts not returned. */
const gemini = (id: string, model: ScriptedModel): ModelEntry => ({
  ...mockEntry(id, model.model),
  providerOptions: {
    google: { thinkingConfig: { thinkingLevel: "low", includeThoughts: false } },
  },
});

const includeThoughts = (model: ScriptedModel, call = 0) =>
  (
    model.calls[call]!.providerOptions?.["google"] as
      { thinkingConfig?: { includeThoughts?: boolean } } | undefined
  )?.thinkingConfig?.includeThoughts;

async function answer(
  source: AnswerRequest["source"],
  chain: ModelEntry[],
  extra: Partial<AnswerRequest> = {},
) {
  const config = fixtureConfig();
  const question = "Where is he based?";
  const run = streamAnswer({
    messages: [{ role: "user", content: wrapVisitor(question, "en") }],
    question,
    locale: "en",
    language: "en",
    sessionId: "reasoning-session-0001",
    sessionHash: "reasoning",
    source,
    route: { route: "lite", reason: "default" },
    corpus: twoProjectCorpus(config),
    config,
    chain,
    abortSignal: new AbortController().signal,
    persist: false,
    ...extra,
  });
  const chunks: UIMessageChunk[] = await drain(run.stream);
  return { chunks, outcome: await run.done };
}

const streamed = (chunks: UIMessageChunk[]) =>
  chunks.flatMap((c) => (c.type === "reasoning-delta" ? [c.delta] : [])).join("");

describe("thoughts (the admin's answers only)", () => {
  for (const source of ["playground", "eval"] as const) {
    it(`a ${source} answer asks for them, keeps them and streams them`, async () => {
      const model = scripted([thinkingTurn(THOUGHT, ANSWER)]);
      const { chunks, outcome } = await answer(source, [gemini("gemini-3.5-flash-lite", model)]);

      expect(includeThoughts(model)).toBe(true);
      expect(outcome.reasoning).toBe(THOUGHT);
      expect(streamed(chunks)).toBe(THOUGHT);
      // The thoughts are not the answer.
      expect(outcome.text).toBe(ANSWER);
    });
  }

  it("a visitor's answer neither asks for them nor keeps or streams any a model sends", async () => {
    const model = scripted([thinkingTurn(THOUGHT, ANSWER)]);
    const { chunks, outcome } = await answer("terminal", [gemini("gemini-3.5-flash-lite", model)]);

    expect(includeThoughts(model)).toBe(false);
    expect(outcome.reasoning).toBeNull();
    expect(chunks.some((c) => c.type.startsWith("reasoning"))).toBe(false);
    expect(outcome.text).toBe(ANSWER);
  });

  it("goes round the word pacing: a long thought arrives whole, before the answer's words", async () => {
    const long = "Check the profile, then the FAQ. ".repeat(200);
    const model = scripted([thinkingTurn(long, ANSWER)]);
    const { chunks, outcome } = await answer("playground", [
      gemini("gemini-3.5-flash-lite", model),
    ]);

    const kinds = chunks.map((c) => c.type);
    // One part, not 1,200 words at ten milliseconds each.
    expect(kinds.filter((k) => k === "reasoning-delta")).toHaveLength(1);
    expect(kinds.indexOf("reasoning-delta")).toBeLessThan(kinds.indexOf("text-delta"));
    // The answer's words are paced as before.
    expect(kinds.filter((k) => k === "text-delta").length).toBeGreaterThan(1);
    expect(outcome.reasoning).toBe(long.trim());
  });

  it("asks the deep chain an answer moves up to for them too, and only the admin's", async () => {
    for (const source of ["eval", "terminal"] as const) {
      const lite = scripted([
        toolTurn("get_document", { id: "project:atlas@en" }, "c1"),
        toolTurn("get_document", { id: "project:borealis@en" }, "c2"),
      ]);
      const deep = scripted([thinkingTurn("Compare the two.", "Both [^project:atlas@en].")]);
      const { chunks, outcome } = await answer(source, [gemini("gemini-3.5-flash-lite", lite)], {
        escalation: () => [gemini("gemini-3.7-flash", deep)],
      });

      const admin = source === "eval";
      expect(outcome.escalation).toBe("projects-fetched");
      expect(includeThoughts(lite)).toBe(admin);
      expect(includeThoughts(deep)).toBe(admin);
      expect(outcome.reasoning).toBe(admin ? "Compare the two." : null);
      expect(chunks.some((c) => c.type.startsWith("reasoning"))).toBe(admin);
    }
  });
});
