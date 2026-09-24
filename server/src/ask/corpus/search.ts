import MiniSearch from "minisearch";

import type { Locale } from "../../content/schema.js";
import type { CorpusDocument, CorpusKind } from "./build.js";

/**
 * BM25 search (MiniSearch: fuzzy and prefix matching) over paragraph-sized
 * chunks of the corpus. Built once per corpus key and kept with the corpus.
 */

interface Chunk {
  id: string;
  docId: string;
  locale: Locale;
  kind: CorpusKind;
  title: string;
  url: string;
  text: string;
}

export interface SearchHit {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

const CHUNK_CHARS = 700;
const SNIPPET_CHARS = 320;

export function chunkDocument(doc: CorpusDocument): Chunk[] {
  const chunks: Chunk[] = [];
  let current = "";
  const push = () => {
    const text = current.trim();
    if (text) {
      chunks.push({
        id: `${doc.id}#${chunks.length}`,
        docId: doc.id,
        locale: doc.locale,
        kind: doc.kind,
        title: doc.title,
        url: doc.url,
        text,
      });
    }
    current = "";
  };
  for (const line of doc.text.split("\n")) {
    if (current.length + line.length > CHUNK_CHARS && current) push();
    // A single line longer than a chunk is split on its own.
    for (let rest = line; rest.length; rest = rest.slice(CHUNK_CHARS)) {
      current += `${rest.slice(0, CHUNK_CHARS)}\n`;
      if (rest.length > CHUNK_CHARS) push();
    }
  }
  push();
  return chunks;
}

export class CorpusSearch {
  private readonly index = new MiniSearch<Chunk>({
    fields: ["title", "text"],
    storeFields: ["docId", "locale", "kind", "title", "url", "text"],
    searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2 },
  });

  constructor(documents: CorpusDocument[]) {
    this.index.addAll(documents.flatMap(chunkDocument));
  }

  /**
   * Best chunk per document, the page's language first; the other language
   * fills in when this one has nothing (a post written only in English).
   */
  search(
    query: string,
    options: { locale: Locale; kinds?: CorpusKind[]; limit?: number },
  ): SearchHit[] {
    const limit = options.limit ?? 6;
    const kinds = options.kinds?.length ? new Set(options.kinds) : null;
    const results = this.index.search(query, {
      filter: (r) => !kinds || kinds.has(r["kind"] as CorpusKind),
    });

    const pick = (locale: Locale | null) => {
      const seen = new Set<string>();
      const hits: SearchHit[] = [];
      for (const r of results) {
        if (locale && r["locale"] !== locale) continue;
        const docId = r["docId"] as string;
        if (seen.has(docId)) continue;
        seen.add(docId);
        const text = r["text"] as string;
        hits.push({
          id: docId,
          title: r["title"] as string,
          url: r["url"] as string,
          snippet: text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text,
        });
        if (hits.length >= limit) break;
      }
      return hits;
    };

    const own = pick(options.locale);
    return own.length ? own : pick(null);
  }
}
