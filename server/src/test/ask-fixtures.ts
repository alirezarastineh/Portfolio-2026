import type { AskConfig } from "../ask/config.js";
import { parseAskConfig } from "../ask/config.js";
import type { Corpus } from "../ask/corpus/build.js";
import { assembleCorpus, type AskCorpus } from "../ask/corpus/index.js";
import { DEFAULT_SETTINGS } from "../ask/settings.js";

/** A small published corpus: enough to cite, search and navigate. */
export const FIXTURE_BASE: Corpus = {
  key: "en:1|de:2",
  documents: [
    {
      id: "profile@en",
      kind: "profile",
      locale: "en",
      title: "Alireza Rastineh",
      url: "/en",
      text: "Alireza Rastineh — Senior AI / full-stack engineer\nAvailability: open\nLocation: Berlin, DE",
    },
    {
      id: "project:atlas@en",
      kind: "project",
      locale: "en",
      title: "Atlas",
      url: "/en/work/atlas",
      text: "Atlas — retrieval-augmented support assistant\nStack: Python, pgvector, Gemini\nMetric: 38% fewer escalations",
    },
    {
      id: "profile@de",
      kind: "profile",
      locale: "de",
      title: "Alireza Rastineh",
      url: "/de",
      text: "Alireza Rastineh — Senior AI / Full-Stack Engineer",
    },
  ],
  text: "",
  projects: [
    {
      id: "project:atlas@en",
      slug: "atlas",
      locale: "en",
      name: "Atlas",
      descriptor: "retrieval-augmented support assistant",
      role: "Lead engineer",
      period: "2024-01 – Present",
      category: "AI",
      stack: ["Python", "pgvector", "Gemini"],
      tags: ["rag"],
      metrics: ["38% fewer escalations"],
      url: "/en/work/atlas",
      hasCaseStudy: true,
    },
  ],
  posts: [],
};

/** Settings as a deploy with a Gemini key would have them, tightened for tests. */
export function fixtureConfig(overrides: Partial<AskConfig> = {}): AskConfig {
  const saved = { ...process.env };
  process.env.SERVER_AI_ENABLED = "true";
  process.env.SERVER_GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
  process.env.GEMINI_DEEP_MODEL = "gemini-3.7-flash";
  try {
    return {
      ...parseAskConfig(),
      firstChunkTimeoutMs: 300,
      requestTimeoutMs: 3_000,
      streamTimeoutMs: 10_000,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      maxRetries: 0,
      ...overrides,
    };
  } finally {
    process.env = saved;
  }
}

export function fixtureCorpus(config: AskConfig = fixtureConfig()): AskCorpus {
  return assembleCorpus(FIXTURE_BASE, DEFAULT_SETTINGS, [], config);
}

/** The UI message stream as parsed chunks. */
export async function readUiChunks(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

export function uiText(chunks: Record<string, unknown>[]): string {
  return chunks
    .filter((c) => c["type"] === "text-delta")
    .map((c) => c["delta"] as string)
    .join("");
}

/** Waits for something the stream's end writes asynchronously (the log row). */
export async function eventually<T>(
  read: () => Promise<T | undefined>,
  timeoutMs = 3_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
