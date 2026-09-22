import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import { getDb } from "../db/client.js";
import { contentDocuments, mediaAssets, projects } from "../db/schema.js";
import { isSafeMediaFilename } from "../lib/media-sniff.js";
import { mediaExists, openMedia } from "../lib/media-store.js";

/**
 * Public media serving. Mounted outside the admin router — uploaded images must
 * be fetchable by anyone viewing the portfolio.
 */
export const mediaRouter = new Hono();

mediaRouter.get("/:name", async (c) => {
  const name = c.req.param("name");

  // Two independent checks: the allowlist pattern, and (inside openMedia) a
  // resolved-path containment test. Either alone would be enough; both is
  // cheap insurance against a regression in one.
  if (!isSafeMediaFilename(name)) {
    return c.json({ error: "not_found" }, 404);
  }

  const [asset] = await getDb()
    .select({ mime: mediaAssets.mime, checksum: mediaAssets.checksumSha256 })
    .from(mediaAssets)
    .where(eq(mediaAssets.filename, name))
    .limit(1);

  if (!asset || !(await mediaExists(name))) {
    return c.json({ error: "not_found" }, 404);
  }

  const etag = `"${asset.checksum.toString("hex").slice(0, 32)}"`;
  if (c.req.header("if-none-match") === etag) {
    return c.body(null, 304);
  }

  const stream = openMedia(name);
  if (!stream) return c.json({ error: "not_found" }, 404);

  c.header("Content-Type", asset.mime);
  // Safe to cache forever: filenames are UUIDs and are never reused.
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Disposition", "inline");
  c.header("ETag", etag);

  return c.body(stream as unknown as ReadableStream);
});

/**
 * Everything that references a given asset. Used to refuse a delete that would
 * leave a project pointing at a missing image.
 */
export async function findMediaUsage(id: string, filename: string): Promise<string[]> {
  const db = getDb();
  const usedBy: string[] = [];

  const referencing = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.imageId, id));
  usedBy.push(...referencing.map((r) => `project:${r.slug}`));

  // Also catch a path pasted straight into a content document.
  const documents = await db
    .select({ section: contentDocuments.section, locale: contentDocuments.locale })
    .from(contentDocuments)
    .where(sql`${contentDocuments.data}::text like ${"%" + filename + "%"}`);
  usedBy.push(...documents.map((d) => `${d.section}:${d.locale}`));

  const byPath = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(sql`${projects.imagePath} like ${"%" + filename + "%"}`);
  for (const row of byPath) {
    const key = `project:${row.slug}`;
    if (!usedBy.includes(key)) usedBy.push(key);
  }

  return usedBy;
}

export async function listMediaAssets() {
  return getDb().select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt));
}
