import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from "h3";

import fallbackDe from "../../../../../app/content/fallback.de.json";
import fallbackEn from "../../../../../app/content/fallback.en.json";

type Locale = "en" | "de";

const LOCALES: readonly Locale[] = ["en", "de"];
const FALLBACK: Record<Locale, unknown> = { en: fallbackEn, de: fallbackDe };

const TTL_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 2_000;

interface CacheEntry {
  payload: unknown;
  etag: string | null;
  cachedAt: number;
}

const fresh = new Map<Locale, CacheEntry>();
/** Survives TTL expiry so an API outage degrades to stale, not to blank. */
const lastKnownGood = new Map<Locale, CacheEntry>();

export function invalidate(locale?: Locale): void {
  if (locale) fresh.delete(locale);
  else fresh.clear();
}

function isLocale(value: string | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/**
 * This route exists because `API_INTERNAL_BASE_URL` is only readable from Nitro
 * code — Vite inlines `process.env` into the Angular SSR bundle at build time,
 * so an Angular service literally cannot see it.
 *
 * It also makes the client's fetch URL identical on server and browser, which
 * is what activates Angular's HTTP transfer cache.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");

  if (!isLocale(locale)) {
    setResponseStatus(event, 400);
    return { error: "unsupported_locale" };
  }

  const cached = fresh.get(locale);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return respond(event, cached, "cache");
  }

  let base = process.env["API_INTERNAL_BASE_URL"] ?? "";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  if (base) {
    try {
      const upstream = await fetch(`${base}/v1/content/${locale}`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });

      if (upstream.ok) {
        const entry: CacheEntry = {
          payload: await upstream.json(),
          etag: upstream.headers.get("etag"),
          cachedAt: Date.now(),
        };
        fresh.set(locale, entry);
        lastKnownGood.set(locale, entry);
        return respond(event, entry, "api");
      }

      console.error(`[content] upstream ${upstream.status} for "${locale}"`);
    } catch (error) {
      console.error(`[content] upstream unreachable for "${locale}"`, error);
    }
  }

  const stale = lastKnownGood.get(locale);
  if (stale) {
    return respond(event, stale, "stale");
  }

  return respond(
    event,
    { payload: FALLBACK[locale], etag: null, cachedAt: Date.now() },
    "fallback",
  );
});

function respond(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  entry: CacheEntry,
  source: "api" | "cache" | "stale" | "fallback",
): unknown {
  setResponseHeader(event, "X-Content-Source", source);
  setResponseHeader(
    event,
    "Cache-Control",
    source === "fallback"
      ? "no-store"
      : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  if (entry.etag) {
    setResponseHeader(event, "ETag", entry.etag);
  }
  return entry.payload;
}
