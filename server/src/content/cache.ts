import type { AppContent, Locale } from "./schema.js";

export interface PublishedEntry {
  payload: AppContent;
  versionId: number;
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

/**
 * Lives in its own module so `publish.ts` can clear it without importing the
 * route, and the route can read it without importing publish.
 */
export function invalidateContentCache(locale?: Locale): void {
  if (locale) cache.delete(locale);
  else cache.clear();
}
