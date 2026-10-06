import { createHash } from "node:crypto";
import MiniSearch from "minisearch";

import type { Locale } from "../../content/schema.js";
import type { CorpusDocument, CorpusKind } from "./build.js";

/**
 * BM25 search (MiniSearch: fuzzy and prefix matching) over paragraph-sized
 * chunks of the corpus. Built once per corpus key and kept with the corpus.
 */

export interface Chunk {
  id: string;
  docId: string;
  locale: Locale;
  kind: CorpusKind;
  title: string;
  url: string;
  text: string;
  /** Of the text: what a stored embedding is keyed by (plan phase 18). */
  hash: string;
}

export interface SearchHit {
  id: string;
  title: string;
  url: string;
  snippet: string;
  /** The document's related documents (plan phase 19), when it has any. */
  related?: string[];
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
        hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
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

function toHit(
  chunk: Pick<Chunk, "docId" | "title" | "url" | "text">,
  related: readonly string[] | undefined,
): SearchHit {
  const { text } = chunk;
  return {
    id: chunk.docId,
    title: chunk.title,
    url: chunk.url,
    snippet: text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS)}…` : text,
    ...(related?.length ? { related: [...related] } : {}),
  };
}

export class CorpusSearch {
  private readonly index = new MiniSearch<Chunk>({
    fields: ["title", "text"],
    storeFields: ["docId", "locale", "kind", "title", "url", "text"],
    searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.2 },
  });

  /** Every chunk, in corpus order: what the embeddings cover. */
  readonly chunks: readonly Chunk[];
  private readonly byId: ReadonlyMap<string, Chunk>;
  /** Each document's related ids (plan phase 19), for its hits. */
  private readonly related: ReadonlyMap<string, readonly string[]>;

  constructor(documents: CorpusDocument[]) {
    this.chunks = documents.flatMap(chunkDocument);
    this.byId = new Map(this.chunks.map((c) => [c.id, c]));
    this.related = new Map(documents.flatMap((d) => (d.related ? [[d.id, d.related]] : [])));
    this.index.addAll([...this.chunks]);
  }

  /** BM25's ranking over both languages: chunk ids, best first; on a tie, `prefer`'s first. */
  rank(query: string, kinds?: readonly CorpusKind[], prefer?: Locale): string[] {
    const allowed = kinds?.length ? new Set(kinds) : null;
    return this.index
      .search(query, { filter: (r) => !allowed || allowed.has(r["kind"] as CorpusKind) })
      .sort(
        (a, b) =>
          b.score - a.score || Number(a["locale"] !== prefer) - Number(b["locale"] !== prefer),
      )
      .map((r) => String(r.id));
  }

  /** A ranking of chunks as hits: the best chunk per document, at most `limit`. */
  hits(ranked: readonly string[], limit = 6): SearchHit[] {
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const id of ranked) {
      const chunk = this.byId.get(id);
      if (!chunk || seen.has(chunk.docId)) continue;
      seen.add(chunk.docId);
      hits.push(toHit(chunk, this.related.get(chunk.docId)));
      if (hits.length >= limit) break;
    }
    return hits;
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
        hits.push(
          toHit(
            {
              docId,
              title: r["title"] as string,
              url: r["url"] as string,
              text: r["text"] as string,
            },
            this.related.get(docId),
          ),
        );
        if (hits.length >= limit) break;
      }
      return hits;
    };

    const own = pick(options.locale);
    return own.length ? own : pick(null);
  }
}
