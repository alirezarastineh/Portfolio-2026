import { desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { DbExecutor } from "../content/build.js";
import { getDb } from "../db/client.js";
import {
  contentDocuments,
  experiences,
  mediaAssets,
  mediaVariants,
  postTranslations,
  posts,
  profileResumes,
  projectGallery,
  projects,
  projectTranslations,
  siteProfile,
} from "../db/schema.js";
import { isSafeMediaFilename } from "../lib/media-sniff.js";
import { mediaExists, openMedia } from "../lib/media-store.js";

/**
 * Public media serving. Mounted outside the admin router — uploaded images must
 * be fetchable by anyone viewing the portfolio.
 */
export const mediaRouter = new Hono();

interface Served {
  mime: string;
  etag: string;
  /** Set for documents: the name a browser saves the file under. */
  downloadName: string | null;
}

/** An original by its own row, or a resized variant by its parent's. */
async function lookup(name: string): Promise<Served | null> {
  const db = getDb();
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      mime: mediaAssets.mime,
      kind: mediaAssets.kind,
      originalName: mediaAssets.originalName,
      checksum: mediaAssets.checksumSha256,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.filename, name))
    .limit(1);
  if (asset) {
    return {
      mime: asset.mime,
      etag: `"${asset.checksum.toString("hex").slice(0, 32)}"`,
      downloadName:
        asset.kind === "document" ? await documentName(db, asset.id, asset.originalName) : null,
    };
  }

  const [variant] = await db
    .select({
      format: mediaVariants.format,
      width: mediaVariants.width,
      checksum: mediaAssets.checksumSha256,
    })
    .from(mediaVariants)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaVariants.assetId))
    .where(eq(mediaVariants.filename, name))
    .limit(1);
  if (variant) {
    return {
      mime: `image/${variant.format}`,
      etag: `"${variant.checksum.toString("hex").slice(0, 24)}-${variant.width}${variant.format}"`,
      downloadName: null,
    };
  }
  return null;
}

/**
 * The uploader's filename, reduced to characters that are safe in a header.
 * The real file on disk is always `<uuid>.pdf`; this is only what the browser
 * offers when saving.
 */
function safeDownloadName(originalName: string): string {
  const base = headerSafe(originalName).replace(/\.pdf$/i, "") || "document";
  return `${base}.pdf`;
}

/** Letters, digits, `.`, `_` and `-` only: accents dropped, spaces as `-`. */
function headerSafe(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 100);
}

/**
 * The name a document is saved under. A CV is `Alireza-Rastineh-CV-en.pdf`,
 * whatever it was uploaded as (`/{locale}/resume.pdf` redirects here); one
 * PDF set as the CV for both languages drops the language. Any other document
 * keeps its uploader's name.
 */
async function documentName(
  db: DbExecutor,
  assetId: string,
  originalName: string,
): Promise<string> {
  const resumes = await db
    .select({ locale: profileResumes.locale })
    .from(profileResumes)
    .where(eq(profileResumes.mediaId, assetId))
    .orderBy(profileResumes.locale);
  if (resumes.length === 0) return safeDownloadName(originalName);

  const [profile] = await db.select({ name: siteProfile.name }).from(siteProfile).limit(1);
  const person = headerSafe(profile?.name ?? "");
  const prefix = person ? `${person}-` : "";
  const locale = resumes.length === 1 ? `-${resumes[0]!.locale}` : "";
  return `${prefix}CV${locale}.pdf`;
}

mediaRouter.get("/:name", async (c) => {
  const name = c.req.param("name");

  // Two independent checks: the allowlist pattern, and (inside openMedia) a
  // resolved-path containment test. Either alone would be enough; both is
  // cheap insurance against a regression in one.
  if (!isSafeMediaFilename(name)) {
    return c.json({ error: "not_found" }, 404);
  }

  const served = await lookup(name);
  if (!served || !(await mediaExists(name))) {
    return c.json({ error: "not_found" }, 404);
  }

  if (c.req.header("if-none-match") === served.etag) {
    return c.body(null, 304);
  }

  const stream = openMedia(name);
  if (!stream) return c.json({ error: "not_found" }, 404);

  c.header("Content-Type", served.mime);
  // Safe to cache forever: filenames are UUIDs and are never reused.
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Disposition",
    served.downloadName ? `inline; filename="${served.downloadName}"` : "inline",
  );
  // No `sandbox` CSP on PDFs: Chrome refuses to render a PDF under it. Only
  // the admin can upload one, and browsers' PDF viewers do not run as the page.
  c.header("ETag", served.etag);

  return c.body(stream as unknown as ReadableStream);
});

/**
 * Everything in the draft that references a given asset. Used to refuse a
 * delete that would leave the draft pointing at a missing file — the foreign
 * keys (RESTRICT) would refuse it too, but without saying what uses it.
 */
export async function findMediaUsage(
  id: string,
  filename: string,
  db: DbExecutor = getDb(),
): Promise<string[]> {
  const usedBy = new Set<string>();
  const like = `%/media/${filename}%`;

  const projectRefs = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.coverId, id));
  for (const row of projectRefs) usedBy.add(`project:${row.slug}`);

  const gallery = await db
    .select({ slug: projects.slug })
    .from(projectGallery)
    .innerJoin(projects, eq(projects.id, projectGallery.projectId))
    .where(eq(projectGallery.mediaId, id));
  for (const row of gallery) usedBy.add(`project:${row.slug} (gallery)`);

  // An image placed inside a body or a rich-text field.
  const inProjectText = await db
    .select({ slug: projects.slug })
    .from(projectTranslations)
    .innerJoin(projects, eq(projects.id, projectTranslations.projectId))
    .where(
      or(
        sql`${projectTranslations.body} like ${like}`,
        sql`${projectTranslations.problem} like ${like}`,
        sql`${projectTranslations.aiArchitecture} like ${like}`,
        sql`${projectTranslations.fullStackInfra} like ${like}`,
      ),
    );
  for (const row of inProjectText) usedBy.add(`project:${row.slug}`);

  const [profile] = await db
    .select({ avatarId: siteProfile.avatarId })
    .from(siteProfile)
    .where(eq(siteProfile.avatarId, id))
    .limit(1);
  if (profile) usedBy.add("profile:avatar");

  const resumes = await db
    .select({ locale: profileResumes.locale })
    .from(profileResumes)
    .where(eq(profileResumes.mediaId, id));
  for (const row of resumes) usedBy.add(`resume:${row.locale}`);

  const logos = await db
    .select({ orgName: experiences.orgName })
    .from(experiences)
    .where(eq(experiences.logoId, id));
  for (const row of logos) usedBy.add(`experience:${row.orgName}`);

  const postRefs = await db
    .selectDistinct({ slug: posts.slug })
    .from(posts)
    .leftJoin(postTranslations, eq(postTranslations.postId, posts.id))
    .where(or(eq(posts.coverId, id), sql`${postTranslations.body} like ${like}`));
  for (const row of postRefs) usedBy.add(`post:${row.slug}`);

  // Also catch a path pasted straight into a content document (and the legal pages).
  const documents = await db
    .select({ section: contentDocuments.section, locale: contentDocuments.locale })
    .from(contentDocuments)
    .where(sql`${contentDocuments.data}::text like ${"%" + filename + "%"}`);
  for (const d of documents) usedBy.add(`${d.section}:${d.locale}`);

  return [...usedBy];
}

/** An uploaded original's name (`<uuid>.<ext>`) wherever it appears in a text. */
const ORIGINAL_NAME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+/gi;

/**
 * `findMediaUsage` for every asset at once, for the library's "unused" filter:
 * a handful of queries instead of eight per asset. Texts are scanned for file
 * names once, rather than once per asset.
 */
export async function mediaUsageAll(db: DbExecutor = getDb()): Promise<Map<string, string[]>> {
  const assets = await db
    .select({ id: mediaAssets.id, filename: mediaAssets.filename })
    .from(mediaAssets);
  const usage = new Map(assets.map((a) => [a.id, new Set<string>()]));
  const idByName = new Map(assets.map((a) => [a.filename.toLowerCase(), a.id]));

  const byId = (id: string | null, label: string) => {
    if (id) usage.get(id)?.add(label);
  };
  const byText = (text: string | null, label: string) => {
    for (const match of (text ?? "").matchAll(ORIGINAL_NAME)) {
      byId(idByName.get(match[0].toLowerCase()) ?? null, label);
    }
  };

  for (const p of await db
    .select({ slug: projects.slug, coverId: projects.coverId })
    .from(projects)) {
    byId(p.coverId, `project:${p.slug}`);
  }

  for (const g of await db
    .select({ slug: projects.slug, mediaId: projectGallery.mediaId })
    .from(projectGallery)
    .innerJoin(projects, eq(projects.id, projectGallery.projectId))) {
    byId(g.mediaId, `project:${g.slug} (gallery)`);
  }

  for (const t of await db
    .select({
      slug: projects.slug,
      body: projectTranslations.body,
      problem: projectTranslations.problem,
      aiArchitecture: projectTranslations.aiArchitecture,
      fullStackInfra: projectTranslations.fullStackInfra,
    })
    .from(projectTranslations)
    .innerJoin(projects, eq(projects.id, projectTranslations.projectId))) {
    byText([t.body, t.problem, t.aiArchitecture, t.fullStackInfra].join("\n"), `project:${t.slug}`);
  }

  for (const p of await db.select({ avatarId: siteProfile.avatarId }).from(siteProfile)) {
    byId(p.avatarId, "profile:avatar");
  }
  for (const r of await db
    .select({ locale: profileResumes.locale, mediaId: profileResumes.mediaId })
    .from(profileResumes)) {
    byId(r.mediaId, `resume:${r.locale}`);
  }
  for (const e of await db
    .select({ orgName: experiences.orgName, logoId: experiences.logoId })
    .from(experiences)) {
    byId(e.logoId, `experience:${e.orgName}`);
  }

  for (const p of await db.select({ slug: posts.slug, coverId: posts.coverId }).from(posts)) {
    byId(p.coverId, `post:${p.slug}`);
  }
  for (const t of await db
    .select({ slug: posts.slug, body: postTranslations.body })
    .from(postTranslations)
    .innerJoin(posts, eq(posts.id, postTranslations.postId))) {
    byText(t.body, `post:${t.slug}`);
  }

  for (const d of await db
    .select({
      section: contentDocuments.section,
      locale: contentDocuments.locale,
      data: sql<string>`${contentDocuments.data}::text`,
    })
    .from(contentDocuments)) {
    byText(d.data, `${d.section}:${d.locale}`);
  }

  return new Map([...usage].map(([id, labels]) => [id, [...labels]]));
}

export async function listMediaAssets() {
  return getDb().select().from(mediaAssets).orderBy(desc(mediaAssets.createdAt));
}
