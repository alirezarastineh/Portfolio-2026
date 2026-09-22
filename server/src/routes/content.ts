import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { getCached, setCached, type PublishedEntry } from "../content/cache.js";
import { localeSchema, type AppContent, type Locale } from "../content/schema.js";
import { getDb } from "../db/client.js";
import { contentPointers, contentVersions } from "../db/schema.js";

async function loadPublished(locale: Locale): Promise<PublishedEntry | null> {
  const cached = getCached(locale);
  if (cached) return cached;

  const db = getDb();
  const [row] = await db
    .select({
      payload: contentVersions.payload,
      versionId: contentVersions.id,
      publishedAt: contentPointers.publishedAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId))
    .where(eq(contentPointers.locale, locale))
    .orderBy(desc(contentVersions.id))
    .limit(1);

  if (!row) return null;

  const entry: PublishedEntry = {
    payload: row.payload as AppContent,
    versionId: row.versionId,
    publishedAt: row.publishedAt.toISOString(),
    cachedAt: Date.now(),
  };
  setCached(locale, entry);
  return entry;
}

export const contentRouter = new Hono();

contentRouter.get("/:locale", async (c) => {
  const parsed = localeSchema.safeParse(c.req.param("locale"));
  if (!parsed.success) {
    return c.json({ error: "unsupported_locale" }, 400);
  }

  const entry = await loadPublished(parsed.data);
  if (!entry) {
    return c.json({ error: "not_published" }, 503);
  }

  // Version ids are monotonic and a publish always mints a new one, so this is
  // a precise validator — no need to hash the body.
  const etag = `W/"${parsed.data}-${entry.versionId}"`;
  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=30");
  c.header("X-Content-Version", String(entry.versionId));
  // Correct HTTP, and the client's sitemap route reads it for `lastmod`.
  c.header("Last-Modified", new Date(entry.publishedAt).toUTCString());

  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }

  return c.json(entry.payload);
});
