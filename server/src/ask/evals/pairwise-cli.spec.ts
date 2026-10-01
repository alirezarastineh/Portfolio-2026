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
    expect(labels(pairwiseSides(config, "lite,gemini-3.7-flash", undefined))).toEqual([
      ["lite", buildChain(config, "lite").map((e) => e.id)],
      ["gemini-3.7-flash", ["gemini-3.7-flash"]],
    ]);
  });

  it("compares a candidate prompt on the main model, the current prompt on the other side", () => {
    const planned = pairwiseSides(config, undefined, "candidate.md", () => "You are a candidate.");
    expect(labels(planned)).toEqual([
      ["gemini-3.5-flash-lite · current prompt", ["gemini-3.5-flash-lite"]],
      ["gemini-3.5-flash-lite · candidate.md", ["gemini-3.5-flash-lite"]],
    ]);
    expect("sides" in planned && planned.sides.map((s) => s.systemPrompt)).toEqual([
      undefined,
      "You are a candidate.",
    ]);
  });

  it("refuses one answerer, the same one twice without a prompt, and an unknown one", () => {
    expect(pairwiseSides(config, "lite", undefined)).toEqual({
      error: "--pairwise takes two answerers, such as lite,deep or two model ids.",
    });
    expect(pairwiseSides(config, "lite,", undefined)).toHaveProperty("error");
    expect(pairwiseSides(config, "deep,deep", undefined)).toEqual({
      error: 'Both sides are "deep": name two answerers, or add --candidate-prompt.',
    });
    // No OpenRouter key in the fixture: an OpenRouter model cannot answer.
    const noKey = { ...config, openrouter: { ...config.openrouter, apiKey: "" } };
    expect(pairwiseSides(noKey, "lite,vendor/model:free", undefined)).toEqual({
      error:
        'No model for "vendor/model:free": name a route (lite, deep) or a model whose key is set.',
    });
  });
});
