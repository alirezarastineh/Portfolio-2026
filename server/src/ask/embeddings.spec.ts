import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4 } from "ai/test";

import { fixtureConfig } from "../test/ask-fixtures.js";
import type { AskConfig } from "./config.js";
import type { CorpusDocument } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";
import { askCorpusFromSnapshot } from "./corpus/snapshots.js";
import {
  embeddingTokens,
  embedInMemory,
  hybridSearch,
  type SearchSpend,
  normalise,
  normaliseQuery,
  resetEmbeddings,
  rrf,
  setEmbeddingDeps,
} from "./embeddings.js";
import type { ModelCall } from "./models/fallback.js";

/**
 * Plan phase 18: BM25 and embeddings fused by rank. A scripted embedding
 * model maps a text to the concepts it is about (operations, cost, search),
 * so meaning can be told apart from words without a network.
 */

const CONCEPTS: [RegExp, number][] = [
  [/mlops|llm ops|in production|betrieb/i, 0],
  [/cost|kosten|budget/i, 1],
  [/retrieval|search|suche/i, 2],
];

function vectorOf(text: string): number[] {
  const v = [0, 0, 0, 0.05];
  for (const [pattern, dim] of CONCEPTS) if (pattern.test(text)) v[dim] = 1;
  return v;
}

function embeddingModel(options: { fail?: boolean; delayMs?: number } = {}) {
  return new MockEmbeddingModelV4({
    modelId: "gemini-embedding-2",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values, abortSignal }) => {
      if (options.fail) throw new Error("embedding service down");
      if (options.delayMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, options.delayMs);
          abortSignal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(abortSignal.reason);
          });
        });
      }
      return {
        embeddings: values.map(vectorOf),
        usage: { tokens: values.join(" ").split(/\s+/).length },
        warnings: [],
      };
    },
  });
}

const doc = (d: Partial<CorpusDocument> & Pick<CorpusDocument, "id" | "text">): CorpusDocument => ({
  kind: "post",
  locale: d.id.endsWith("@de") ? "de" : "en",
  title: d.id,
  url: "/x",
  ...d,
});

const DOCUMENTS: CorpusDocument[] = [
  doc({ id: "profile@en", kind: "profile", text: "Senior AI engineer in Berlin." }),
  doc({ id: "post:mlops@en", text: "MLOps for prompts: versions, evals and rollbacks." }),
  doc({ id: "project:atlas@en", kind: "project", text: "Atlas: retrieval over 40,000 documents." }),
  doc({ id: "skills@en", kind: "skills", text: "TypeScript, Python" }),
  doc({ id: "skills@de", kind: "skills", text: "TypeScript, Python" }),
  doc({ id: "post:kosten@de", text: "Kosten im Griff: Budgets für KI-Funktionen." }),
];

let config: AskConfig;
let corpus: AskCorpus;
let recorded: ModelCall[][];
let model: MockEmbeddingModelV4;

async function ready(over: { fail?: boolean; delayMs?: number; available?: boolean } = {}) {
  const use = (m: MockEmbeddingModelV4, available: boolean) =>
    setEmbeddingDeps({
      model: () => m,
      available: async () => available,
      record: async (calls) => {
        recorded.push(calls);
      },
    });
  // The chunks' vectors, from a model that never fails, as a backfill would have stored them.
  use(embeddingModel(), true);
  await embedInMemory(corpus, config);
  model = embeddingModel(over);
  use(model, over.available ?? true);
}

const search = (
  query: string,
  reading: "en" | "de" = "en",
  spend: SearchSpend = { record: true },
) => hybridSearch(corpus, query, { config, reading, spend });

beforeEach(() => {
  resetEmbeddings();
  recorded = [];
  config = fixtureConfig();
  config = {
    ...config,
    embeddings: { enabled: true, model: "gemini-embedding-2", dims: 4, queryTimeoutMs: 200 },
  };
  // These documents alone: no FAQ or system card to match the queries' words.
  corpus = askCorpusFromSnapshot({
    key: "test",
    documents: DOCUMENTS,
    projects: [],
    posts: [],
    coreTokens: 0,
  });
});

afterEach(() => setEmbeddingDeps(null));

describe("rank fusion", () => {
  it("adds 1 / (60 + rank) per list, so what both lists rank high wins", () => {
    const scores = rrf([
      ["a", "b", "c"],
      ["c", "a"],
    ]);
    expect(scores.get("a")).toBeCloseTo(1 / 61 + 1 / 62);
    expect(scores.get("c")).toBeCloseTo(1 / 63 + 1 / 61);
    expect(scores.get("b")).toBeCloseTo(1 / 62);
    expect([...scores].sort((x, y) => y[1] - x[1]).map(([id]) => id)).toEqual(["a", "c", "b"]);
  });

  it("compares by direction: vectors are normalised, queries by their text", () => {
    const v = normalise([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(normaliseQuery("  LLM   Ops ")).toBe("llm ops");
  });
});

describe("hybrid search", () => {
  it("finds by meaning what the words miss: a synonym, and the other language", async () => {
    await ready();
    expect(corpus.search.search("LLM ops", { locale: "en" })).toEqual([]);
    const synonym = await search("LLM ops");
    expect(synonym.semantic).toBe(true);
    expect(synonym.hits[0]?.id).toBe("post:mlops@en");

    // No English document is about cost; the German post is, and the semantic side reads both.
    expect(corpus.search.search("How does he keep costs down?", { locale: "en" })).toEqual([]);
    const crossLanguage = await search("How does he keep costs down?");
    expect(crossLanguage.hits[0]?.id).toBe("post:kosten@de");
  });

  it("keeps what BM25 finds near the top, and prefers the reading language on a tie", async () => {
    await ready();
    expect((await search("retrieval")).hits[0]?.id).toBe("project:atlas@en");
    expect((await search("TypeScript", "de")).hits[0]?.id).toBe("skills@de");
    expect((await search("TypeScript", "en")).hits[0]?.id).toBe("skills@en");
  });

  it("embeds a question once however it is typed, and records its tokens as the embeddings feature", async () => {
    await ready();
    recorded = [];
    const answer: ModelCall[] = [];
    await search("LLM ops", "en", { record: true, calls: answer });
    await search("  llm   OPS ", "en", { record: true, calls: answer });
    expect(model.doEmbedCalls).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]![0]).toMatchObject({ model: "gemini-embedding-2" });
    expect(recorded[0]![0]!.usage?.inputTokens.total).toBeGreaterThan(0);
    // The answer keeps the same spend for its own cost; a cached query costs nothing.
    expect(answer).toEqual(recorded[0]);

    // An eval's search: kept for the run to record, not written here.
    const evalAnswer: ModelCall[] = [];
    await search("rollbacks", "en", { record: false, calls: evalAnswer });
    expect(model.doEmbedCalls).toHaveLength(2);
    expect(recorded).toHaveLength(1);
    expect(evalAnswer).toHaveLength(1);
  });

  it("counts a query's tokens itself when the provider reports none, as Gemini does", async () => {
    // Gemini's embedding API returns no usage: the SDK says NaN. A NaN written to the
    // usage tables fails, and the search would fall back to words every time.
    const silent = new MockEmbeddingModelV4({
      modelId: "gemini-embedding-2",
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => ({ embeddings: values.map(vectorOf), warnings: [] }),
    });
    setEmbeddingDeps({ model: () => silent, available: async () => true });
    const embedded = await embedInMemory(corpus, config);
    expect(embedded.calls[0]!.usage?.inputTokens.total).toBeGreaterThan(0);
    recorded = [];
    setEmbeddingDeps({
      model: () => silent,
      available: async () => true,
      record: async (calls) => {
        recorded.push(calls);
      },
    });
    const result = await search("LLM ops");
    expect(result.semantic).toBe(true);
    const tokens = recorded[0]![0]!.usage!.inputTokens.total!;
    expect(Number.isFinite(tokens) && tokens > 0).toBe(true);
    expect(embeddingTokens(Number.NaN, ["LLM ops"])).toBeGreaterThan(0);
    expect(embeddingTokens(7, ["anything"])).toBe(7);
  });

  it("searches by words alone, without embedding the query, while a passage lacks its vector", async () => {
    // Nothing embedded yet: the backfill has not run.
    setEmbeddingDeps({ model: () => (model = embeddingModel()), available: async () => true });
    const bm25 = (query: string) => corpus.search.search(query, { locale: "en" });
    expect(await search("retrieval")).toEqual({ hits: bm25("retrieval"), semantic: false });
    expect(model.doEmbedCalls).toHaveLength(0);

    // All but one new passage: an eval's corpus that matches stored vectors only in places.
    await ready();
    const grown = askCorpusFromSnapshot({
      key: "test-grown",
      documents: [...DOCUMENTS, doc({ id: "post:new@en", text: "A passage nobody embedded." })],
      projects: [],
      posts: [],
      coreTokens: 0,
    });
    const before = model.doEmbedCalls.length;
    expect(
      await hybridSearch(grown, "retrieval", { config, reading: "en", spend: { record: true } }),
    ).toEqual({ hits: grown.search.search("retrieval", { locale: "en" }), semantic: false });
    expect(model.doEmbedCalls).toHaveLength(before);
    expect(recorded).toEqual([]);
  });

  it("embeds an eval's corpus in memory only where the fence allows, and hands back the spend", async () => {
    setEmbeddingDeps({ model: () => embeddingModel(), available: async () => false });
    expect(await embedInMemory(corpus, config)).toEqual({ passages: 0, calls: [] });

    setEmbeddingDeps({ model: () => embeddingModel(), available: async () => true });
    const embedded = await embedInMemory(corpus, config);
    // The two skills documents are one text: embedded once.
    expect(embedded.passages).toBe(DOCUMENTS.length - 1);
    expect(embedded.calls).toEqual([
      expect.objectContaining({ model: "gemini-embedding-2", answerOnly: false }),
    ]);
    // Nothing left to embed the second time.
    expect(await embedInMemory(corpus, config)).toEqual({ passages: 0, calls: [] });
  });

  it("falls back to BM25 alone when off, failing, slow or fenced", async () => {
    const bm25 = (query: string) => corpus.search.search(query, { locale: "en" });

    await ready({ fail: true });
    expect(await search("retrieval")).toEqual({ hits: bm25("retrieval"), semantic: false });

    resetEmbeddings();
    await ready({ delayMs: 1_000 });
    expect(await search("retrieval")).toEqual({ hits: bm25("retrieval"), semantic: false });

    resetEmbeddings();
    await ready({ available: false });
    expect(await search("retrieval")).toEqual({ hits: bm25("retrieval"), semantic: false });
    expect(model.doEmbedCalls).toHaveLength(0);

    resetEmbeddings();
    await ready();
    const off = { ...config, embeddings: { ...config.embeddings, enabled: false } };
    const before = model.doEmbedCalls.length;
    expect(
      await hybridSearch(corpus, "LLM ops", {
        config: off,
        reading: "en",
        spend: { record: true },
      }),
    ).toEqual({
      hits: [],
      semantic: false,
    });
    expect(model.doEmbedCalls).toHaveLength(before);
  });

  it("keeps a search's kinds on the semantic side too", async () => {
    await ready();
    // BM25 finds no project for these words; the semantic side still offers only projects.
    expect(corpus.search.search("LLM ops", { locale: "en", kinds: ["project"] })).toEqual([]);
    const projects = await hybridSearch(corpus, "LLM ops", {
      config,
      reading: "en",
      kinds: ["project"],
      spend: { record: false },
    });
    expect(projects.semantic).toBe(true);
    expect(projects.hits.map((h) => h.id)).toEqual(["project:atlas@en"]);
  });
});
