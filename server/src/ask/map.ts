import { createHash } from "node:crypto";

import type { Locale } from "../content/schema.js";
import type { CorpusDocument } from "./corpus/build.js";
import type { AskCorpus } from "./corpus/index.js";

/**
 * The portfolio's map (visitor plan V15; the book's Progressive Discovery:
 * forage, focus, deepen). One language's published pages, each with the day
 * it last changed and the pages related to it, strongest first, as the corpus
 * holds them (plan phase 19). The browser builds read next and what's new
 * from it; no model is called, and it is served with the assistant off.
 */

/** The documents that are pages of the site: the assistant's own (FAQ, system card) and the CV are not. */
export const MAP_KINDS = ["profile", "experience", "project", "post", "skills"] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export interface MapPage {
  /** The corpus's id, as citations name it: `project:atlas@en`. */
  id: string;
  kind: MapKind;
  title: string;
  /** The page's path: a case study, a post, or a section of home. */
  url: string;
  /** `YYYY-MM-DD`, where the corpus dates it (`CorpusDocument.updated`). */
  updated?: string;
  /** Pages of the same language related to it, strongest first; never itself. */
  related: string[];
}

export interface PortfolioMap {
  v: 1;
  locale: Locale;
  pages: MapPage[];
}

function isPage(d: CorpusDocument): d is CorpusDocument & { kind: MapKind } {
  return (MAP_KINDS as readonly string[]).includes(d.kind);
}

/** The map of one language, in the corpus's order; related ids that are not pages are left out. */
export function portfolioMap(documents: readonly CorpusDocument[], locale: Locale): PortfolioMap {
  const pages = documents.filter(isPage).filter((d) => d.locale === locale);
  const ids = new Set(pages.map((d) => d.id));
  return {
    v: 1,
    locale,
    pages: pages.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      url: d.url,
      ...(d.updated ? { updated: d.updated } : {}),
      related: (d.related ?? []).filter((id) => id !== d.id && ids.has(id)),
    })),
  };
}

/** A weak validator: the corpus's key and the language name the map exactly. */
export function mapEtag(corpusKey: string, locale: Locale): string {
  const hash = createHash("sha256").update(`${corpusKey}|${locale}`).digest("hex").slice(0, 16);
  return `W/"map-${locale}-${hash}"`;
}

/** Whether an `If-None-Match` header names `etag` (it may list several, or `*`). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((tag) => {
    const value = tag.trim();
    return value === "*" || value === etag;
  });
}

/** Each corpus's maps, made once per language: a corpus is memoised by its key until it changes. */
const made = new WeakMap<AskCorpus, Map<Locale, { map: PortfolioMap; etag: string }>>();

export function mapOf(
  corpus: Pick<AskCorpus, "key" | "documents">,
  locale: Locale,
): { map: PortfolioMap; etag: string } {
  const key = corpus as AskCorpus;
  let maps = made.get(key);
  if (!maps) {
    maps = new Map();
    made.set(key, maps);
  }
  let entry = maps.get(locale);
  if (!entry) {
    entry = { map: portfolioMap(corpus.documents, locale), etag: mapEtag(corpus.key, locale) };
    maps.set(locale, entry);
  }
  return entry;
}
