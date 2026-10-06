import type { Locale } from "../../content/schema.js";
import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import type { SearchHit } from "../corpus/search.js";
import { hybridSearch } from "../embeddings.js";
import type { ModelCall } from "../models/fallback.js";

/**
 * The search alone, by words and by words and meaning (plan phase 18): where
 * each query's expected document ranks among the search tool's hits. The eval
 * cases test answers, which can still find a document by fetching it whole;
 * these test the search the answers lean on, over the gaps the fixture holds
 * on purpose (a synonym, a question in the other language either way) and a
 * words case that must not get worse. No model answers; the CLI's
 * `--retrieval` embeds the queries (a few calls).
 */

export interface RetrievalCase {
  id: string;
  query: string;
  /** The reading language the search prefers (the answer's). */
  reading: Locale;
  /** The document the search should find. */
  expect: string;
}

export const RETRIEVAL_CASES: RetrievalCase[] = [
  // The post says "MLOps"; nothing says "LLM ops".
  { id: "synonym", query: "LLM ops", reading: "en", expect: "post:llm-in-production@en" },
  // A German question over an English-only post, and the other way round.
  {
    id: "de-question-en-post",
    query: "Wie rollt er Prompt-Änderungen zurück?",
    reading: "de",
    expect: "post:llm-in-production@en",
  },
  {
    id: "en-question-de-post",
    query: "How does he keep costs down?",
    reading: "en",
    expect: "post:kosten-im-griff@de",
  },
  // Words find it already: the fusion must keep it near the top.
  { id: "words", query: "pgvector", reading: "en", expect: "project:atlas@en" },
];

export interface RetrievalResult {
  id: string;
  /** The expected document's rank among the hits by words alone (1 first), or null. */
  words: number | null;
  /** Its rank by words and meaning, or null. */
  hybrid: number | null;
  /** Whether the embeddings took part (false: the search fell back to words). */
  semantic: boolean;
}

function rankOf(hits: readonly SearchHit[], id: string): number | null {
  const i = hits.findIndex((hit) => hit.id === id);
  return i < 0 ? null : i + 1;
}

/** Each case searched both ways; the queries' embedding spend joins `calls`. */
export async function runRetrieval(
  corpus: AskCorpus,
  config: AskConfig,
  calls: ModelCall[] = [],
  cases: readonly RetrievalCase[] = RETRIEVAL_CASES,
): Promise<RetrievalResult[]> {
  return Promise.all(
    cases.map(async (c) => {
      const words = corpus.search.search(c.query, { locale: c.reading });
      const hybrid = await hybridSearch(corpus, c.query, {
        config,
        reading: c.reading,
        spend: { record: false, calls },
      });
      return {
        id: c.id,
        words: rankOf(words, c.expect),
        hybrid: rankOf(hybrid.hits, c.expect),
        semantic: hybrid.semantic,
      };
    }),
  );
}
