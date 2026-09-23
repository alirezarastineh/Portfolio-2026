import { appContentSchema, docKey, docSchema, type DocKind } from "../../app/content/schema";
import fallbackDe from "../../app/content/fallback.de.json";
import fallbackDocsDe from "../../app/content/fallback-docs.de.json";
import fallbackDocsEn from "../../app/content/fallback-docs.en.json";
import fallbackEn from "../../app/content/fallback.en.json";

/**
 * The one place the SSR server fetches published content from the API. The
 * content BFF, the sitemap and robots.txt all go through here, and this is the
 * only importer of the bundled fallback — which keeps it out of the browser.
 */

export type Locale = "en" | "de";
export const LOCALES: readonly Locale[] = ["en", "de"];

export type ContentSource = "api" | "cache" | "stale" | "fallback";

export interface ContentResult {
  payload: unknown;
  etag: string | null;
  /** The API's `Last-Modified`: when this locale was last published. */
  lastModified: string | null;
  source: ContentSource;
}

interface Entry {
  payload: unknown;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: number;
}

const TTL_MS = 60_000;
/** A doc that does not exist yet may be published any moment; ask again soon. */
const MISSING_TTL_MS = 10_000;
const UPSTREAM_TIMEOUT_MS = 2_000;
const MAX_DOCS = 256;

const FALLBACK: Record<Locale, unknown> = { en: fallbackEn, de: fallbackDe };
const FALLBACK_DOCS: Record<Locale, Record<string, unknown>> = {
  en: fallbackDocsEn,
  de: fallbackDocsDe,
};

const fresh = new Map<Locale, Entry>();
/** Survives TTL expiry, so an API outage degrades to stale content, not to the fallback. */
const lastKnownGood = new Map<Locale, Entry>();

/** Docs by `locale:kind:slug`; a null payload is a cached 404. */
const freshDocs = new Map<string, Entry>();
const lastKnownGoodDocs = new Map<string, Entry>();

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Called after a publish, so the next request fetches instead of waiting out the TTL. */
export function invalidate(locale?: Locale): void {
  if (locale) fresh.delete(locale);
  else fresh.clear();
  // Docs follow the core's version, so every one may have changed.
  freshDocs.clear();
}

function apiBase(): string {
  let base = process.env["API_INTERNAL_BASE_URL"] ?? "";
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

function bounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key) && map.size >= MAX_DOCS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

type Upstream =
  { kind: "ok"; entry: Entry } | { kind: "unchanged" } | { kind: "missing" } | { kind: "failed" };

/**
 * One conditional GET against the API. Payloads are validated here, on the
 * server, so a malformed one degrades to the last good one instead of
 * reaching every visitor's browser.
 */
async function fetchUpstream(
  path: string,
  known: Entry | undefined,
  validate: (payload: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues: unknown[] };
  },
): Promise<Upstream> {
  const base = apiBase();
  if (!base) return { kind: "failed" };

  try {
    const upstream = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        // Unchanged since the last fetch → a 304 with no body to transfer or parse.
        ...(known?.etag ? { "if-none-match": known.etag } : {}),
      },
    });

    if (upstream.status === 304 && known) return { kind: "unchanged" };
    if (upstream.status === 404) return { kind: "missing" };
    if (upstream.ok) {
      const parsed = validate(await upstream.json());
      if (parsed.success) {
        return {
          kind: "ok",
          entry: {
            payload: parsed.data,
            etag: upstream.headers.get("etag"),
            lastModified: upstream.headers.get("last-modified"),
            fetchedAt: Date.now(),
          },
        };
      }
      console.error(
        `[content] upstream payload for ${path} is invalid`,
        parsed.error?.issues.slice(0, 3),
      );
    } else {
      console.error(`[content] upstream ${upstream.status} for ${path}`);
    }
  } catch (error) {
    console.error(`[content] upstream unreachable for ${path}`, error);
  }
  return { kind: "failed" };
}

export async function getContent(locale: Locale): Promise<ContentResult> {
  const cached = fresh.get(locale);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return { ...cached, source: "cache" };

  const known = lastKnownGood.get(locale);
  const result = await fetchUpstream(`/v2/content/${locale}`, known, (p) =>
    appContentSchema.safeParse(p),
  );

  if (result.kind === "unchanged" && known)
    return remember(locale, { ...known, fetchedAt: Date.now() });
  if (result.kind === "ok") return remember(locale, result.entry);

  if (known) return { ...known, source: "stale" };
  return { payload: FALLBACK[locale], etag: null, lastModified: null, source: "fallback" };
}

function remember(locale: Locale, entry: Entry): ContentResult {
  fresh.set(locale, entry);
  lastKnownGood.set(locale, entry);
  return { ...entry, source: "api" };
}

export interface DocResult extends ContentResult {
  /** Null: this locale has no such doc. */
  payload: unknown;
}

/** One case study, post or legal page, cached and revalidated like the core. */
export async function getDoc(locale: Locale, kind: DocKind, slug: string): Promise<DocResult> {
  const key = `${locale}:${kind}:${slug}`;
  const cached = freshDocs.get(key);
  if (
    cached &&
    Date.now() - cached.fetchedAt < (cached.payload === null ? MISSING_TTL_MS : TTL_MS)
  ) {
    return { ...cached, source: "cache" };
  }

  const known = lastKnownGoodDocs.get(key);
  const result = await fetchUpstream(`/v2/content/${locale}/${kind}/${slug}`, known, (p) =>
    docSchema.safeParse(p),
  );

  const keep = (entry: Entry): DocResult => {
    bounded(freshDocs, key, entry);
    bounded(lastKnownGoodDocs, key, entry);
    return { ...entry, source: "api" };
  };
  if (result.kind === "unchanged" && known) return keep({ ...known, fetchedAt: Date.now() });
  if (result.kind === "ok") return keep(result.entry);
  if (result.kind === "missing") {
    const missing = { payload: null, etag: null, lastModified: null, fetchedAt: Date.now() };
    bounded(freshDocs, key, missing);
    return { ...missing, source: "api" };
  }

  if (known) return { ...known, source: "stale" };
  const fallback = FALLBACK_DOCS[locale][docKey(kind, slug)] ?? null;
  return { payload: fallback, etag: null, lastModified: null, source: "fallback" };
}

/** The site's origin, from the identity (or else the canonical URL) the core declares. */
export function siteOriginOf(payload: unknown, fallback: string): string {
  const content = payload as {
    identity?: { siteUrl?: unknown };
    seo?: { canonical?: unknown };
  } | null;
  for (const candidate of [content?.identity?.siteUrl, content?.seo?.canonical]) {
    try {
      if (typeof candidate === "string" && candidate) return new URL(candidate).origin;
    } catch {
      // try the next one
    }
  }
  return fallback;
}
