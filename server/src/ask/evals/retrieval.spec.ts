import { afterEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4 } from "ai/test";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import type { AskConfig } from "../config.js";
import { embedInMemory, hybridSearch, resetEmbeddings, setEmbeddingDeps } from "../embeddings.js";
import type { ModelCall } from "../models/fallback.js";
import { fixtureAskCorpus } from "./fixture.js";
import { RETRIEVAL_CASES, runRetrieval } from "./retrieval.js";

/**
 * Plan phase 18's evidence at the search level. The fixture's gaps are pinned
 * here for words alone, free: the CLI's paid `--retrieval` then shows whether
 * meaning closes them with the real embedding model.
 */

const withEmbeddings = (config: AskConfig): AskConfig => ({
  ...config,
  embeddings: { ...config.embeddings, enabled: true, dims: 3 },
});

/** A stand-in for meaning: operations, cost, rollback, each a direction. */
function conceptModel() {
  const concepts: [RegExp, number][] = [
    [/llm ops|mlops/i, 0],
    [/cost|kosten|budget/i, 1],
    [/rollback|zurück/i, 2],
  ];
  return new MockEmbeddingModelV4({
    modelId: "gemini-embedding-2",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((text) => {
        const v = [0.01, 0.01, 0.01];
        for (const [pattern, dim] of concepts) if (pattern.test(text)) v[dim] = 1;
        return v;
      }),
      usage: { tokens: values.length },
      warnings: [],
    }),
  });
}

afterEach(() => {
  setEmbeddingDeps(null);
  resetEmbeddings();
});

describe("the retrieval report", () => {
  it("finds the fixture's gaps by words alone, and keeps the words case", async () => {
    // Embeddings off: the hybrid side is words too.
    const config = fixtureConfig();
    const results = await runRetrieval(fixtureAskCorpus(config), config);
    expect(results.map((r) => r.id)).toEqual(RETRIEVAL_CASES.map((c) => c.id));
    for (const r of results) expect(r.semantic).toBe(false);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("synonym")).toMatchObject({ words: null, hybrid: null });
    expect(byId.get("de-question-en-post")).toMatchObject({ words: null, hybrid: null });
    expect(byId.get("en-question-de-post")).toMatchObject({ words: null, hybrid: null });
    expect(byId.get("words")?.words).not.toBeNull();
  });

  it("ranks by words and meaning once the corpus is embedded, and keeps the queries' spend", async () => {
    const config = withEmbeddings(fixtureConfig());
    setEmbeddingDeps({ model: conceptModel, available: async () => true });
    const corpus = fixtureAskCorpus(config);
    await embedInMemory(corpus, config);
    const spent: ModelCall[] = [];
    const results = await runRetrieval(corpus, config, spent);
    for (const r of results) expect(r.semantic).toBe(true);
    const byId = new Map(results.map((r) => [r.id, r]));
    expect(byId.get("synonym")?.hybrid).not.toBeNull();
    expect(byId.get("en-question-de-post")?.hybrid).not.toBeNull();
    expect(byId.get("words")?.hybrid).not.toBeNull();
    expect(spent).toHaveLength(RETRIEVAL_CASES.length);

    // A hit by meaning carries its related documents too (plan phase 19).
    const { hits, semantic } = await hybridSearch(corpus, "Would he relocate?", {
      config,
      reading: "en",
      spend: { record: false },
    });
    expect(semantic).toBe(true);
    expect(hits.find((h) => h.id === "faq:b5d6e7f8@en")?.related).toEqual(["profile@en"]);
  });
});
