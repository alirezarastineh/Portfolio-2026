import { describe, expect, it } from "vitest";

import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { drain, mockEntry, scripted, textAndToolTurn, toolTurn } from "../test/ask-models.js";
import { streamAnswer } from "./agent.js";
import { wrapVisitor } from "./prompt.js";

/**
 * A stuttered tool name (`suggest_suggest_followups`, seen in production and
 * in an eval run) used to fail the whole answer with NoSuchToolError. The
 * agent now calls the one tool it can only mean; anything less certain still
 * fails.
 */

function answer(turns: Parameters<typeof scripted>[0]) {
  const config = fixtureConfig();
  const model = scripted(turns);
  const { stream, done } = streamAnswer({
    messages: [{ role: "user", content: wrapVisitor("Where is he based?", "en") }],
    question: "Where is he based?",
    locale: "en",
    language: "en",
    sessionId: "repair-session-00001",
    sessionHash: "repair",
    source: "eval",
    route: { route: "lite", reason: "test" },
    corpus: fixtureCorpus(config),
    config,
    chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
    abortSignal: new AbortController().signal,
    persist: false,
  });
  return { stream, done };
}

describe("a stuttered tool name", () => {
  it("is repaired to the tool it can only mean, and the answer completes", async () => {
    const { stream, done } = answer([
      textAndToolTurn("He is based in Berlin [^profile@en].", "suggest_suggest_followups", {
        items: ["What does he build?", "Is he available?"],
      }),
    ]);
    await drain(stream);
    const outcome = await done;
    expect(outcome.finishReason).not.toMatch(/^error/);
    expect(outcome.toolCalls.map((c) => c.name)).toEqual(["suggest_followups"]);
    expect(outcome.citedIds).toEqual(["profile@en"]);
  });

  it("still fails when no single tool fits", async () => {
    const { stream, done } = answer([toolTurn("delete_everything", {})]);
    await drain(stream);
    expect((await done).finishReason).toBe("error:error");
  });
});
