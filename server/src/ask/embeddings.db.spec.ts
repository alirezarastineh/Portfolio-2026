import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockEmbeddingModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiEmbeddings, aiSettings, aiUsageFeatures } from "../db/schema.js";
import { fixtureConfig } from "../test/ask-fixtures.js";
import { resetDb } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import type { CorpusDocument } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";
import { askCorpusFromSnapshot } from "./corpus/snapshots.js";
import {
  allowEmbeddingBackfill,
  backfillEmbeddings,
  hybridSearch,
  resetEmbeddings,
  setEmbeddingDeps,
} from "./embeddings.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * Plan phase 18: search vectors are stored per chunk and model, written only
 * where the migrations ran, fenced and counted as the `embeddings` feature.
 */

const corpusOf = (documents: CorpusDocument[]): AskCorpus =>
  askCorpusFromSnapshot({
    key: `k${documents.length}`,
    documents,
    projects: [],
    posts: [],
    coreTokens: 0,
  });

const doc = (id: string, text: string): CorpusDocument => ({
  id,
  kind: "post",
  locale: "en",
  title: id,
  url: "/x",
  text,
});

const DOCS = [doc("post:a@en", "MLOps for prompts."), doc("post:b@en", "Budgets per feature.")];

let config: AskConfig;
let model: MockEmbeddingModelV4;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetEmbeddings();
  allowEmbeddingBackfill(true);
  config = fixtureConfig();
  config = {
    ...config,
    embeddings: { enabled: true, model: "gemini-embedding-2", dims: 3, queryTimeoutMs: 200 },
  };
  model = new MockEmbeddingModelV4({
    modelId: "gemini-embedding-2",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((v) => [v.length, 1, /mlops/i.test(v) ? 1 : 0]),
      usage: { tokens: 10 * values.length },
      warnings: [],
    }),
  });
  // The real fence and the real usage record; only the model is scripted.
  setEmbeddingDeps({ model: () => model });
});

afterEach(() => {
  setEmbeddingDeps(null);
  allowEmbeddingBackfill(false);
});

/** The admin's `embeddings` switch (plan phase 13: off by default). */
async function switchOn(on = true): Promise<void> {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, featureSwitches: { embeddings: on } })
    .onConflictDoUpdate({ target: aiSettings.id, set: { featureSwitches: { embeddings: on } } });
  invalidateAssistantCache();
  resetEmbeddings();
}

const rows = () => getDb().select().from(aiEmbeddings);

describe("search vectors (plan phase 18)", () => {
  it("are a table keyed by chunk hash and model (migration 0019)", async () => {
    const { rows: columns } = await getDb().execute<{ column_name: string; data_type: string }>(sql`
      select column_name, data_type from information_schema.columns
      where table_name = 'ai_embeddings' order by ordinal_position`);
    expect(columns).toEqual([
      { column_name: "content_hash", data_type: "text" },
      { column_name: "model", data_type: "text" },
      { column_name: "dims", data_type: "integer" },
      { column_name: "vector", data_type: "ARRAY" },
      { column_name: "created_at", data_type: "timestamp with time zone" },
    ]);
  });

  it("wait for the admin's switch, then embed each new chunk once, counted as the embeddings feature", async () => {
    await backfillEmbeddings(corpusOf(DOCS), config);
    expect(await rows()).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);

    await switchOn();
    await backfillEmbeddings(corpusOf(DOCS), config);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ model: "gemini-embedding-2", dims: 3 });
    // Stored at unit length.
    const v = stored[0]!.vector;
    expect(Math.hypot(...v)).toBeCloseTo(1);
    const [usage] = await getDb()
      .select()
      .from(aiUsageFeatures)
      .where(eq(aiUsageFeatures.feature, "embeddings"));
    expect(usage).toMatchObject({ model: "gemini-embedding-2", requests: 1, inputTokens: 20 });

    // Nothing new: no call. One chunk changed: only it.
    const calls = model.doEmbedCalls.length;
    await backfillEmbeddings(corpusOf(DOCS), config);
    expect(model.doEmbedCalls).toHaveLength(calls);
    await backfillEmbeddings(corpusOf([...DOCS, doc("post:c@en", "A new post.")]), config);
    expect(model.doEmbedCalls).toHaveLength(calls + 1);
    expect(model.doEmbedCalls.at(-1)!.values).toEqual(["A new post."]);
    expect(await rows()).toHaveLength(3);
  });

  it("are never written where the migrations did not run, nor with the deploy's flag off", async () => {
    await switchOn();
    allowEmbeddingBackfill(false);
    await backfillEmbeddings(corpusOf(DOCS), config);
    allowEmbeddingBackfill(true);
    await backfillEmbeddings(corpusOf(DOCS), {
      ...config,
      embeddings: { ...config.embeddings, enabled: false },
    });
    expect(await rows()).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  it("are pruned once 30 days old if no chunk of the live corpus holds them", async () => {
    await switchOn();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const corpus = corpusOf(DOCS);
    // A chunk of the live corpus, embedded long ago: still in use, so kept.
    const inUse = corpus.search.chunks[0]!.hash;
    const vector = { model: "gemini-embedding-2", dims: 3, vector: [1, 0, 0] };
    await getDb()
      .insert(aiEmbeddings)
      .values([
        { ...vector, contentHash: "old-unused", createdAt: old },
        { ...vector, contentHash: "new-unused" },
        { ...vector, contentHash: inUse, createdAt: old },
        { ...vector, model: "another", contentHash: "old-other-model", createdAt: old },
      ]);
    await backfillEmbeddings(corpus, config);
    const hashes = (await rows()).map((r) => r.contentHash);
    // The other chunk got its vector; the old one in use was not embedded again.
    expect(hashes).toHaveLength(4);
    expect(hashes.filter((h) => h === inUse)).toHaveLength(1);
    expect(hashes).toEqual(expect.arrayContaining(["new-unused", "old-other-model", inUse]));
    expect(hashes).not.toContain("old-unused");
  });

  it("stop at once when the admin switches the feature off, cached verdict or not", async () => {
    await switchOn();
    await backfillEmbeddings(corpusOf(DOCS), config);
    const search = () =>
      hybridSearch(corpusOf(DOCS), "operations for prompts", {
        config,
        reading: "en",
        spend: { record: false },
      });
    expect((await search()).semantic).toBe(true);
    const embedded = model.doEmbedCalls.length;

    // What the Settings save does: the row, then the settings cache, and nothing else.
    await getDb()
      .update(aiSettings)
      .set({ featureSwitches: { embeddings: false } })
      .where(eq(aiSettings.id, 1));
    invalidateAssistantCache();
    expect((await search()).semantic).toBe(false);
    expect(model.doEmbedCalls).toHaveLength(embedded);
  });

  it("are read back from the database for a search, so a restart keeps them", async () => {
    await switchOn();
    await backfillEmbeddings(corpusOf(DOCS), config);
    resetEmbeddings();
    const result = await hybridSearch(corpusOf(DOCS), "operations for prompts", {
      config,
      reading: "en",
      spend: { record: false },
    });
    expect(result.semantic).toBe(true);
    expect(result.hits[0]?.id).toBe("post:a@en");
  });
});
