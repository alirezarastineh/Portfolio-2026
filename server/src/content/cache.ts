import type { AppContent, Doc, Locale } from "./schema.js";

export interface PublishedEntry {
  /** Always v2: older snapshots are upcast before they are cached. */
  payload: AppContent;
  versionId: number;
  /** The stored payload's own schema version (1 before content model v2). */
  from: number;
  publishedAt: string;
  cachedAt: number;
}

/**
 * Invalidated precisely on publish; the TTL is only a backstop in case the API
 * is ever run as more than one replica, where one process's publish would not
 * clear another's map.
 */
const TTL_MS = 30_000;
const cache = new Map<Locale, PublishedEntry>();

/**
 * Docs are keyed by the version they belong to, which never changes once
 * written — so they need no TTL, only a size bound. `null` caches a miss.
 */
const MAX_DOCS = 256;
const docs = new Map<string, Doc | null>();

export function getCached(locale: Locale): PublishedEntry | null {
  const entry = cache.get(locale);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt >= TTL_MS) {
    cache.delete(locale);
    return null;
  }
  return entry;
}

export function setCached(locale: Locale, entry: PublishedEntry): void {
  cache.set(locale, entry);
}

function docCacheKey(versionId: number, key: string): string {
  return `${versionId}:${key}`;
}

export function getCachedDoc(versionId: number, key: string): Doc | null | undefined {
  return docs.get(docCacheKey(versionId, key));
}

export function setCachedDoc(versionId: number, key: string, doc: Doc | null): void {
  if (docs.size >= MAX_DOCS) {
    // Oldest first: Map iterates in insertion order.
    const oldest = docs.keys().next().value;
    if (oldest !== undefined) docs.delete(oldest);
  }
  docs.set(docCacheKey(versionId, key), doc);
}

/**
 * Lives in its own module so `publish.ts` can clear it without importing the
 * route, and the route can read it without importing publish.
 */
export function invalidateContentCache(locale?: Locale): void {
  if (locale) cache.delete(locale);
  else cache.clear();
  // Cheap to refill, and a rollback reuses no version id — but a cleared map
  // keeps memory honest after many publishes.
  docs.clear();
}
