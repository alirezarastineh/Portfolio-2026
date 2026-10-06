import { createGoogle } from "@ai-sdk/google";
import type { EmbeddingModelV4 } from "@ai-sdk/provider";
import { embed, embedMany } from "ai";
import { and, eq, inArray, lt, notInArray, sql } from "drizzle-orm";

import type { Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import { aiEmbeddings } from "../db/schema.js";
import type { AskConfig } from "./config.js";
import type { CorpusKind } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";
import type { Chunk, SearchHit } from "./corpus/search.js";
import { availability } from "./guard.js";
import type { ModelCall } from "./models/fallback.js";
import { capsOf } from "./models/registry.js";
import { assistantState, type AiSettings } from "./settings.js";
import { countTokens } from "./tokens.js";
import { recordUsage } from "./usage.js";

/**
 * Hybrid retrieval (plan phase 18, RAG): BM25 finds the words, embeddings the
 * meaning ("LLM ops" for MLOps, a German question over an English post), and
 * Reciprocal Rank Fusion merges the two rankings without pretending their
 * scores share a scale. Opt-in twice: the deploy's `SERVER_AI_EMBEDDINGS` and
 * the admin's `embeddings` switch (with its cap and the visitors' reserve,
 * plan phase 13). Anything short of a fused answer, an error, a slow
 * embedding, the feature off or a passage without its vector, falls back to
 * BM25 alone, exactly as before. In-memory cosine over a few hundred chunks
 * (decision D6).
 */

/** Reciprocal Rank Fusion's constant (the book's, and the usual one). */
export const RRF_K = 60;
const BATCH = 100;
const QUERY_CACHE = 500;
/**
 * A stored vector this old whose chunk is no longer in the live corpus is
 * pruned (by its age, not by its last use: an edit undone after that embeds
 * the chunk again, a fraction of a cent).
 */
const PRUNE_AGE = "30 days";
/** How long a fence verdict holds before the guard is asked again. */
const AVAILABLE_TTL_MS = 30_000;

/** Σ 1/(k + rank) over the lists an item appears in, rank counted from 1. */
export function rrf(lists: readonly (readonly string[])[], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

/** Unit length, so a dot product is the cosine. */
export function normalise(vector: readonly number[]): Float32Array {
  const out = Float32Array.from(vector);
  let sum = 0;
  for (const v of out) sum += v * v;
  const length = Math.sqrt(sum) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= length;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** What the embedding side needs from outside: swapped in tests. */
export interface EmbeddingDeps {
  model: (config: AskConfig) => EmbeddingModelV4 | null;
  /** Whether the `embeddings` feature may spend now (switch, cap, reserve). */
  available: (config: AskConfig) => Promise<boolean>;
  record: (calls: ModelCall[]) => Promise<void>;
}

const models = new WeakMap<AskConfig, EmbeddingModelV4>();

function geminiModel(config: AskConfig): EmbeddingModelV4 | null {
  // No key, or the boot check found no such model: BM25 alone.
  if (!config.gemini.apiKey || capsOf(config.embeddings.model).missing) return null;
  let model = models.get(config);
  if (!model) {
    model = createGoogle({ apiKey: config.gemini.apiKey }).embeddingModel(config.embeddings.model);
    models.set(config, model);
  }
  return model;
}

/**
 * The fence's last verdict, for the settings it was read with: a save in the
 * admin (a switch, a cap) gives new settings and so a new verdict at once; a
 * cap reached by spending shows within 30 s.
 */
let verdict:
  { at: number; config: AskConfig; settings: AiSettings; value: Promise<boolean> } | undefined;

const defaults: EmbeddingDeps = {
  model: geminiModel,
  available: async (config) => {
    const { settings } = await assistantState();
    const now = Date.now();
    if (
      verdict?.config !== config ||
      verdict.settings !== settings ||
      now - verdict.at > AVAILABLE_TTL_MS
    ) {
      const value = availability(config, settings, "embeddings").then(
        (state) => state.state === "ok",
        () => false,
      );
      verdict = { at: now, config, settings, value };
    }
    return verdict.value;
  },
  record: (calls) => recordUsage(calls, "embeddings"),
};

let deps: EmbeddingDeps = defaults;

/** Tests only: the model, the fence and the usage record. */
export function setEmbeddingDeps(next: Partial<EmbeddingDeps> | null): void {
  deps = next ? { ...defaults, ...next } : defaults;
  verdict = undefined;
}

/**
 * What an embedding call used: the provider's count, else the encoder's
 * estimate of the texts. Gemini's embedding API reports none (the SDK then
 * says NaN), and a NaN would make the usage write fail, and with it every
 * search by meaning and every backfill (found by the paid `--retrieval`).
 */
export function embeddingTokens(reported: number | undefined, texts: readonly string[]): number {
  if (reported !== undefined && Number.isFinite(reported) && reported >= 0) return reported;
  return texts.reduce((sum, text) => sum + countTokens(text), 0);
}

/** An embedding call as a model call, so the usage tables price and count it. */
function usageCall(model: string, tokens: number): ModelCall {
  return {
    model,
    answerOnly: false,
    ttftMs: null,
    usage: {
      inputTokens: { total: tokens, noCache: tokens, cacheRead: 0, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
    },
    finishReason: null,
  };
}

/* ------------------------------------------------------------ vectors */

/** In memory, by `model:hash`: loaded per corpus, filled by the backfill. */
const vectors = new Map<string, Float32Array>();
/** Corpus keys whose stored vectors were read, per model. */
const loaded = new Set<string>();

const slot = (model: string, hash: string) => `${model}:${hash}`;

async function loadVectors(corpus: AskCorpus, config: AskConfig): Promise<void> {
  const { model } = config.embeddings;
  const key = `${model}|${corpus.key}`;
  if (loaded.has(key)) return;
  const hashes = [...new Set(corpus.search.chunks.map((c) => c.hash))].filter(
    (h) => !vectors.has(slot(model, h)),
  );
  if (hashes.length) {
    const rows = await getDb()
      .select({ hash: aiEmbeddings.contentHash, vector: aiEmbeddings.vector })
      .from(aiEmbeddings)
      .where(and(eq(aiEmbeddings.model, model), inArray(aiEmbeddings.contentHash, hashes)));
    for (const row of rows) vectors.set(slot(model, row.hash), Float32Array.from(row.vector));
  }
  loaded.add(key);
}

/** The chunks that have a vector, with it. */
function withVectors(
  corpus: AskCorpus,
  config: AskConfig,
): { chunk: Chunk; vector: Float32Array }[] {
  const out: { chunk: Chunk; vector: Float32Array }[] = [];
  for (const chunk of corpus.search.chunks) {
    const vector = vectors.get(slot(config.embeddings.model, chunk.hash));
    if (vector) out.push({ chunk, vector });
  }
  return out;
}

/** The chunks without a vector, each text once. */
function missing(corpus: AskCorpus, config: AskConfig): Chunk[] {
  const seen = new Set<string>();
  return corpus.search.chunks.filter((c) => {
    if (seen.has(c.hash) || vectors.has(slot(config.embeddings.model, c.hash))) return false;
    seen.add(c.hash);
    return true;
  });
}

async function embedChunks(chunks: readonly Chunk[], config: AskConfig, model: EmbeddingModelV4) {
  const { embeddings, usage } = await embedMany({
    model,
    values: chunks.map((c) => c.text),
    maxRetries: 1,
    providerOptions: {
      google: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: config.embeddings.dims },
    },
  });
  return {
    vectors: embeddings.map(normalise),
    tokens: embeddingTokens(
      usage.tokens,
      chunks.map((c) => c.text),
    ),
  };
}

let backfilling: Promise<void> | undefined;
let backfillAllowed = false;
/** Corpus keys whose chunks all have vectors, per model: nothing left to do for them. */
const backfilled = new Set<string>();

/** Called where migrations ran (index.ts): only that API writes vectors. */
export function allowEmbeddingBackfill(allowed = true): void {
  backfillAllowed = allowed;
}

async function backfillBatch(
  todo: readonly Chunk[],
  offset: number,
  config: AskConfig,
  model: EmbeddingModelV4,
): Promise<void> {
  if (offset >= todo.length) return;
  // Asked afresh before each batch; stopped by a fence, the next question tries again.
  verdict = undefined;
  if (!(await deps.available(config))) return;
  const batch = todo.slice(offset, offset + BATCH);
  const embedded = await embedChunks(batch, config, model);
  await getDb()
    .insert(aiEmbeddings)
    .values(
      batch.map((c, j) => ({
        contentHash: c.hash,
        model: config.embeddings.model,
        dims: embedded.vectors[j]!.length,
        vector: [...embedded.vectors[j]!],
      })),
    )
    .onConflictDoNothing();
  batch.forEach((c, j) => vectors.set(slot(config.embeddings.model, c.hash), embedded.vectors[j]!));
  await deps.record([usageCall(config.embeddings.model, embedded.tokens)]);
  return backfillBatch(todo, offset + BATCH, config, model);
}

/**
 * Embeds the chunks of `corpus` that have no stored vector, in batches, each
 * one fenced and recorded as the `embeddings` feature, then prunes the vectors
 * older than 30 days that no chunk of it holds. One at a time; a no-op where
 * it may not write.
 */
export function backfillEmbeddings(corpus: AskCorpus, config: AskConfig): Promise<void> {
  const done = `${config.embeddings.model}|${corpus.key}`;
  if (!config.embeddings.enabled || !backfillAllowed || backfilled.has(done)) {
    return Promise.resolve();
  }
  backfilling ??= (async () => {
    try {
      const model = deps.model(config);
      if (!model) return;
      await loadVectors(corpus, config);
      await backfillBatch(missing(corpus, config), 0, config, model);
      const current = [...new Set(corpus.search.chunks.map((c) => c.hash))];
      await getDb()
        .delete(aiEmbeddings)
        .where(
          and(
            eq(aiEmbeddings.model, config.embeddings.model),
            current.length ? notInArray(aiEmbeddings.contentHash, current) : sql`true`,
            lt(aiEmbeddings.createdAt, sql`now() - ${PRUNE_AGE}::interval`),
          ),
        );
      backfilled.add(done);
    } finally {
      backfilling = undefined;
    }
  })();
  return backfilling;
}

async function embedMemoryBatch(
  todo: readonly Chunk[],
  offset: number,
  config: AskConfig,
  model: EmbeddingModelV4,
  calls: ModelCall[],
): Promise<void> {
  if (offset >= todo.length) return;
  const batch = todo.slice(offset, offset + BATCH);
  const done = await embedChunks(batch, config, model);
  batch.forEach((c, j) => vectors.set(slot(config.embeddings.model, c.hash), done.vectors[j]!));
  calls.push(usageCall(config.embeddings.model, done.tokens));
  return embedMemoryBatch(todo, offset + BATCH, config, model, calls);
}

/**
 * An eval's corpus (the fixture), embedded in memory only, never stored: the
 * eval CLI's and the admin's runs search it by meaning as visitors' answers
 * search the live corpus. Fenced like every embedding; the caller owns the
 * spend it returns (an eval run records it with its items, the CLI prints it).
 */
export async function embedInMemory(
  corpus: AskCorpus,
  config: AskConfig,
): Promise<{ passages: number; calls: ModelCall[] }> {
  const model = deps.model(config);
  if (!config.embeddings.enabled || !model || !(await deps.available(config))) {
    return { passages: 0, calls: [] };
  }
  const todo = missing(corpus, config);
  const calls: ModelCall[] = [];
  await embedMemoryBatch(todo, 0, config, model, calls);
  loaded.add(`${config.embeddings.model}|${corpus.key}`);
  return { passages: todo.length, calls };
}

/* -------------------------------------------------------------- queries */

const queries = new Map<string, Float32Array>();

/** The same question, however typed, is one cache entry. */
export function normaliseQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Where a query's spend goes: written as the `embeddings` feature, and/or kept for the answer. */
export interface SearchSpend {
  /** Written to the usage tables; false where nothing may be written (the eval CLI). */
  record: boolean;
  /** Collects the query's spend for the answer's own cost (and an eval run's record). */
  calls?: ModelCall[];
}

async function embedQuery(
  text: string,
  config: AskConfig,
  model: EmbeddingModelV4,
  spend: SearchSpend,
): Promise<Float32Array> {
  const key = `${config.embeddings.model}|${normaliseQuery(text)}`;
  const hit = queries.get(key);
  if (hit) {
    // Least recently used goes first: a hit moves to the end.
    queries.delete(key);
    queries.set(key, hit);
    return hit;
  }
  const { embedding, usage } = await embed({
    model,
    value: text,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(config.embeddings.queryTimeoutMs),
    providerOptions: {
      google: { taskType: "RETRIEVAL_QUERY", outputDimensionality: config.embeddings.dims },
    },
  });
  const vector = normalise(embedding);
  queries.set(key, vector);
  if (queries.size > QUERY_CACHE) queries.delete(queries.keys().next().value!);
  const call = usageCall(config.embeddings.model, embeddingTokens(usage.tokens, [text]));
  spend.calls?.push(call);
  if (spend.record) await deps.record([call]);
  return vector;
}

export interface HybridResult {
  hits: SearchHit[];
  /** Whether the embeddings took part; false is BM25 alone. */
  semantic: boolean;
}

/**
 * The search tool's ranking. By meaning only over a corpus whose every
 * passage has its vector: a partly embedded one (the backfill still running,
 * or an eval's corpus that matches stored vectors only in places) is searched
 * by words alone, and the query is not embedded.
 */
export async function hybridSearch(
  corpus: AskCorpus,
  query: string,
  options: {
    config: AskConfig;
    reading: Locale;
    kinds?: CorpusKind[];
    limit?: number;
    spend: SearchSpend;
  },
): Promise<HybridResult> {
  const { config, reading, kinds, limit = 6 } = options;
  const bm25Only = (): HybridResult => ({
    hits: corpus.search.search(query, { locale: reading, ...(kinds ? { kinds } : {}), limit }),
    semantic: false,
  });
  if (!config.embeddings.enabled) return bm25Only();
  const model = deps.model(config);
  if (!model) return bm25Only();
  try {
    await loadVectors(corpus, config);
    if (missing(corpus, config).length) return bm25Only();
    const pool = withVectors(corpus, config).filter(
      ({ chunk }) => !kinds?.length || kinds.includes(chunk.kind),
    );
    if (!pool.length || !(await deps.available(config))) return bm25Only();
    const q = await embedQuery(query, config, model, options.spend);
    // Each list breaks its own ties for the reading language, so equal documents in two
    // languages fuse with the reader's first.
    const semantic = pool
      .map(({ chunk, vector }) => ({ id: chunk.id, locale: chunk.locale, score: dot(q, vector) }))
      .sort(
        (a, b) => b.score - a.score || Number(a.locale !== reading) - Number(b.locale !== reading),
      )
      .map((s) => s.id);
    // Each side nominates as many passages as the search returns. Deeper lists over a
    // corpus of a few dozen passages overlap almost wholly, and what both lists hold
    // outranks a passage only one side finds: the synonym the embeddings are there for.
    const scores = rrf([
      corpus.search.rank(query, kinds, reading).slice(0, limit),
      semantic.slice(0, limit),
    ]);
    const localeOf = new Map(corpus.search.chunks.map((c) => [c.id, c.locale]));
    const ranked = [...scores]
      .sort(
        ([a, x], [b, y]) =>
          y - x || Number(localeOf.get(a) !== reading) - Number(localeOf.get(b) !== reading),
      )
      .map(([id]) => id);
    return { hits: corpus.search.hits(ranked, limit), semantic: true };
  } catch {
    // Down, slow or refused: the words still find what they find.
    return bm25Only();
  }
}

/** For health: on, the model, and how many of the corpus's chunks have a stored vector. */
export async function embeddingStatus(corpus: AskCorpus, config: AskConfig) {
  const hashes = [...new Set(corpus.search.chunks.map((c) => c.hash))];
  let embedded = 0;
  if (config.embeddings.enabled && hashes.length) {
    const [row] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(aiEmbeddings)
      .where(
        and(
          eq(aiEmbeddings.model, config.embeddings.model),
          inArray(aiEmbeddings.contentHash, hashes),
        ),
      );
    embedded = row?.n ?? 0;
  }
  return {
    on: config.embeddings.enabled,
    model: config.embeddings.model,
    chunks: hashes.length,
    embedded,
  };
}

/** Tests only. */
export function resetEmbeddings(): void {
  vectors.clear();
  loaded.clear();
  backfilled.clear();
  queries.clear();
  backfilling = undefined;
  verdict = undefined;
}
