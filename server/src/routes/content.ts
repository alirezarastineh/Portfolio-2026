import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";

import {
  getCached,
  getCachedDoc,
  setCached,
  setCachedDoc,
  type PublishedEntry,
} from "../content/cache.js";
import {
  CONTENT_SCHEMA_VERSION,
  docKey,
  docSchema,
  isDocKind,
  localeSchema,
  type Doc,
  type Locale,
} from "../content/schema.js";
import { downcastV1, upcast, upcastDocs } from "../content/upcast.js";
import { getDb } from "../db/client.js";
import { contentPointers, contentVersionDocs, contentVersions } from "../db/schema.js";

/** The live version for a locale, upcast to v2 and cached. */
export async function loadPublished(locale: Locale): Promise<PublishedEntry | null> {
  const cached = getCached(locale);
  if (cached) return cached;

  const [row] = await getDb()
    .select({
      payload: contentVersions.payload,
      versionId: contentVersions.id,
      publishedAt: contentPointers.publishedAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId))
    .where(eq(contentPointers.locale, locale))
    .limit(1);
  if (!row) return null;

  const publishedAt = row.publishedAt.toISOString();
  const result = upcast(row.payload, publishedAt);
  if (!result.ok) {
    // Validated before it was written, so this means the schema moved under a
    // live snapshot. Serving it would break every page; saying so is better.
    console.error(`[content] live ${locale} v${row.versionId} does not validate`, result.issues);
    return null;
  }

  const entry: PublishedEntry = {
    payload: result.content,
    versionId: row.versionId,
    from: result.from,
    publishedAt,
    cachedAt: Date.now(),
  };
  setCached(locale, entry);
  return entry;
}

/** One doc of the live version, or null when it has none by that key. */
export async function loadPublishedDoc(
  locale: Locale,
  entry: PublishedEntry,
  key: string,
): Promise<Doc | null> {
  const cached = getCachedDoc(entry.versionId, key);
  if (cached !== undefined) return cached;

  let doc: Doc | null = null;
  if (entry.from < CONTENT_SCHEMA_VERSION) {
    doc = (await upcastDocs(entry.from, locale, [])).get(key) ?? null;
  } else {
    const [row] = await getDb()
      .select({ payload: contentVersionDocs.payload })
      .from(contentVersionDocs)
      .where(
        and(eq(contentVersionDocs.versionId, entry.versionId), eq(contentVersionDocs.key, key)),
      )
      .limit(1);
    if (row) {
      const parsed = docSchema.safeParse(row.payload);
      if (parsed.success) doc = parsed.data;
      else
        console.error(
          `[content] doc ${key} of v${entry.versionId} does not validate`,
          parsed.error.issues,
        );
    }
  }
  setCachedDoc(entry.versionId, key, doc);
  return doc;
}

function versionHeaders(c: Context, entry: PublishedEntry, etag: string): boolean {
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=30");
  c.header("X-Content-Version", String(entry.versionId));
  // Correct HTTP, and the client's sitemap route reads it for `lastmod`.
  c.header("Last-Modified", new Date(entry.publishedAt).toUTCString());
  return c.req.header("if-none-match") === etag;
}

async function resolveLocale(
  c: Context,
): Promise<
  { ok: true; locale: Locale; entry: PublishedEntry } | { ok: false; response: Response }
> {
  const parsed = localeSchema.safeParse(c.req.param("locale"));
  if (!parsed.success) {
    return { ok: false, response: c.json({ error: "unsupported_locale" }, 400) };
  }
  const entry = await loadPublished(parsed.data);
  if (!entry) {
    return { ok: false, response: c.json({ error: "not_published" }, 503) };
  }
  return { ok: true, locale: parsed.data, entry };
}

/**
 * `/v2/content/:locale` — the core every page needs — and
 * `/v2/content/:locale/:kind/:slug` — one case study, post or legal page.
 *
 * Version ids are monotonic and a publish always mints a new one, so the
 * version is a precise validator — no need to hash the body.
 */
export const contentV2Router = new Hono();

contentV2Router.get("/:locale", async (c) => {
  const resolved = await resolveLocale(c);
  if (!resolved.ok) return resolved.response;
  const { locale, entry } = resolved;

  if (versionHeaders(c, entry, `W/"${locale}-${entry.versionId}"`)) return c.body(null, 304);
  return c.json(entry.payload);
});

contentV2Router.get("/:locale/:kind/:slug", async (c) => {
  const kind = c.req.param("kind");
  const slug = c.req.param("slug");
  if (!isDocKind(kind) || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    return c.json({ error: "not_found" }, 404);
  }

  const resolved = await resolveLocale(c);
  if (!resolved.ok) return resolved.response;
  const { locale, entry } = resolved;

  const key = docKey(kind, slug);
  const doc = await loadPublishedDoc(locale, entry, key);
  if (!doc) {
    // Short, so a doc published a moment later shows up without a long wait.
    c.header("Cache-Control", "public, max-age=10");
    return c.json({ error: "not_found" }, 404);
  }

  if (versionHeaders(c, entry, `W/"${locale}-${entry.versionId}-${key}"`)) return c.body(null, 304);
  return c.json(doc);
});

/**
 * The v1 contract, downcast from the live v2 content, for a client built
 * before v2 during a rolling deploy (API first, then client). Removed in
 * Phase 9.
 */
export const contentV1Router = new Hono();

contentV1Router.get("/:locale", async (c) => {
  const resolved = await resolveLocale(c);
  if (!resolved.ok) return resolved.response;
  const { locale, entry } = resolved;

  if (versionHeaders(c, entry, `W/"${locale}-${entry.versionId}-v1"`)) return c.body(null, 304);
  return c.json(downcastV1(entry.payload));
});
