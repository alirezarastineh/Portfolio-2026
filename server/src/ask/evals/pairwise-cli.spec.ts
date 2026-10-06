import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import { buildChain } from "../models/registry.js";
import { pairwiseSides } from "./pairwise-cli.js";

const config = fixtureConfig();
const labels = (planned: ReturnType<typeof pairwiseSides>) =>
  "sides" in planned ? planned.sides.map((s) => [s.label, s.chain.map((e) => e.id)]) : planned;

describe("the pairwise CLI's sides", () => {
  it("takes two routes or model ids", () => {
    // A route is its whole chain, fallbacks included; a model id is that model alone.
    expect(labels(pairwiseSides(config, { pairwise: "lite,gemini-3.7-flash" }))).toEqual([
      ["lite", buildChain(config, "lite").map((e) => e.id)],
      ["gemini-3.7-flash", ["gemini-3.7-flash"]],
    ]);
  });

  it("compares a candidate prompt on the main model, the current prompt on the other side", () => {
    const planned = pairwiseSides(
      config,
      { candidatePrompt: "candidate.md" },
      () => "You are a candidate.",
    );
    expect(labels(planned)).toEqual([
      ["gemini-3.5-flash-lite · current prompt", ["gemini-3.5-flash-lite"]],
      ["gemini-3.5-flash-lite · candidate.md", ["gemini-3.5-flash-lite"]],
    ]);
    expect("sides" in planned && planned.sides.map((s) => s.systemPrompt)).toEqual([
      undefined,
      "You are a candidate.",
    ]);
  });

  it("compares the core layouts, or a reminder after the corpus, on the main model", () => {
    const cores = pairwiseSides(config, { compareCore: true });
    expect(labels(cores)).toEqual([
      ["gemini-3.5-flash-lite · one core, both languages", ["gemini-3.5-flash-lite"]],
      ["gemini-3.5-flash-lite · a core per language", ["gemini-3.5-flash-lite"]],
    ]);
    expect("sides" in cores && cores.sides.map((s) => s.layout)).toEqual(["both", undefined]);

    const reminder = pairwiseSides(config, { candidateReminder: "reminder.md" }, () => "Cite.");
    expect("sides" in reminder && reminder.sides.map((s) => [s.label, s.afterCorpus])).toEqual([
      ["gemini-3.5-flash-lite", undefined],
      ["gemini-3.5-flash-lite · reminder reminder.md", "Cite."],
    ]);
  });

  it("refuses one answerer, the same one twice without a prompt, and an unknown one", () => {
    expect(pairwiseSides(config, { pairwise: "lite" })).toEqual({
      error: "--pairwise takes two answerers, such as lite,deep or two model ids.",
    });
    expect(pairwiseSides(config, { pairwise: "lite," })).toHaveProperty("error");
    expect(pairwiseSides(config, { pairwise: "deep,deep" })).toEqual({
      error:
        'Both sides are "deep": name two answerers, or add --candidate-prompt, --candidate-reminder or --compare-core.',
    });
    // No OpenRouter key in the fixture: an OpenRouter model cannot answer.
    const noKey = { ...config, openrouter: { ...config.openrouter, apiKey: "" } };
    expect(pairwiseSides(noKey, { pairwise: "lite,vendor/model:free" })).toEqual({
      error:
        'No model for "vendor/model:free": name a route (lite, deep) or a model whose key is set.',
    });
  });
});
