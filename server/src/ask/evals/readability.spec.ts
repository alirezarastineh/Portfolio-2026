import { describe, expect, it } from "vitest";

import { notPlain, PLAIN_BOUNDS, readability, wordsOf } from "./readability.js";

/** Visitor plan V10: the plain level's readability check, in English and German. */

const PLAIN_EN =
  "Atlas is a support assistant that Alireza built [^project:atlas@en]. It helps support agents find answers fast. It searches 40,000 internal documents and shows where each answer comes from. Since it started, about 38% fewer questions needed a senior colleague.";

const EXPERT_EN =
  "Atlas is a retrieval-augmented support assistant whose hybrid retrieval combines BM25 with pgvector embeddings and a cross-encoder reranker, whose generation is grounded with mandatory citations, and whose evaluation suite of 300 real questions gates every prompt and model change, which together cut escalations by 38% while keeping the p95 time to first token at 1.4 seconds [^project:atlas@en].";

const PLAIN_DE =
  "Atlas ist ein Support-Assistent, den Alireza gebaut hat [^project:atlas@de]. Er hilft dem Support, schnell Antworten zu finden. Er durchsucht 40.000 interne Dokumente und zeigt die Quellen. Seitdem gibt es 38 % weniger Eskalationen.";

const EXPERT_DE =
  "Atlas kombiniert hybride Retrieval-Verfahren aus BM25-Volltextsuche und pgvector-Vektorsuche mit anschließendem Reranking, verankert die Generierung durch verpflichtende Quellenangaben und sichert jede Prompt- und Modelländerung über eine Evaluationssuite mit 300 realen Supportanfragen ab, wodurch die Eskalationen um 38 % zurückgingen.";

describe("readability", () => {
  it("counts sentences, words and long words, a colon ending a sentence as LIX has it", () => {
    expect(readability("He builds AI systems: retrieval, evaluation. Fast!")).toEqual({
      words: 7,
      sentences: 3,
      sentenceLength: 7 / 3,
      longShare: 3 / 7,
    });
  });

  it("leaves code, citation markers and Markdown's marks out, and reads list lines as sentences", () => {
    const text =
      "It **ranks** by meaning [^project:atlas@en]:\n\n- BM25 for names\n- embeddings for meaning\n\n```ts\nconst extraordinarilyLongIdentifier = retrieve(query);\n```\nSee `pgvectorConfiguration`.";
    expect(wordsOf(text).join(" ")).toBe(
      "It ranks by meaning BM25 for names embeddings for meaning See",
    );
    expect(readability(text).sentences).toBe(4);
    expect(readability("")).toEqual({ words: 0, sentences: 0, sentenceLength: 0, longShare: 0 });
  });

  it("passes a plain answer and fails a technical one, in English, on either bound", () => {
    expect(notPlain(PLAIN_EN, "en")).toEqual([]);
    expect(notPlain(EXPERT_EN, "en")).toEqual(["not plain: 56.0 words a sentence (at most 20)"]);
    // Short sentences full of jargon.
    expect(
      notPlain(
        "Atlas uses hybrid retrieval. Embeddings precede reranking. Orchestration handles concurrency.",
        "en",
      ),
    ).toEqual(["not plain: 70 % long words (at most 35 %)"]);
  });

  it("passes a plain answer and fails a technical one, in German, whose words run longer", () => {
    expect(notPlain(PLAIN_DE, "de")).toEqual([]);
    expect(notPlain(EXPERT_DE, "de")).toHaveLength(2);
    // The same plain German held to the English bound would fail on its compounds.
    expect(readability(PLAIN_DE).longShare).toBeGreaterThan(PLAIN_BOUNDS.en.longShare);
  });
});
