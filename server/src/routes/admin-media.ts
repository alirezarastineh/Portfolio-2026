import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import { mediaAssets } from "../db/schema.js";
import { sniffImage } from "../lib/media-sniff.js";
import {
  deleteMedia,
  listMediaFiles,
  maxUploadBytes,
  mediaExists,
  restoreMedia,
  sha256,
  storeMedia,
} from "../lib/media-store.js";
import { findMediaUsage, listMediaAssets } from "./media.js";

export const adminMediaRouter = new Hono();

const altInput = z.object({
  altEn: z.string().max(300).nullable().optional(),
  altDe: z.string().max(300).nullable().optional(),
});

function publicUrl(filename: string): string {
  let base = process.env.MEDIA_PUBLIC_BASE_URL ?? "";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return `${base}/media/${filename}`;
}

/** The client's `MediaAsset` shape. Leaves out the raw checksum bytes. */
function toResponse(row: typeof mediaAssets.$inferSelect) {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mime: row.mime,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    altEn: row.altEn,
    altDe: row.altDe,
    createdAt: row.createdAt,
    url: publicUrl(row.filename),
    path: `/media/${row.filename}`,
  };
}

adminMediaRouter.get("/media", async (c) => {
  const rows = await listMediaAssets();
  return c.json({ media: rows.map(toResponse) });
});

adminMediaRouter.post("/media", async (c) => {
  const limit = maxUploadBytes();

  // Reject on the declared length before buffering anything, so an oversized
  // upload costs us nothing.
  const declared = Number.parseInt(c.req.header("content-length") ?? "0", 10);
  if (Number.isFinite(declared) && declared > limit) {
    return c.json({ error: "file_too_large", limit }, 413);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "invalid_upload" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "missing_file" }, 400);
  }
  if (file.size > limit) {
    return c.json({ error: "file_too_large", limit }, 413);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The declared type and the filename are both ignored — only the bytes decide.
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }

  const db = getDb();
  const checksum = sha256(buffer);

  const findByChecksum = async () =>
    (
      await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.checksumSha256, checksum))
        .limit(1)
    )[0];

  // Identical bytes reuse the existing asset instead of filling the volume.
  const existing = await findByChecksum();
  if (existing) {
    // A row whose file is gone (DB restored without media) would otherwise
    // fall through to an insert that the unique checksum rejects. Writing the
    // bytes back under its filename heals the row instead.
    if (!(await mediaExists(existing.filename))) {
      await restoreMedia(buffer, existing.filename);
    }
    return c.json({ ok: true, deduped: true, media: toResponse(existing) });
  }

  const filename = await storeMedia(buffer, sniffed.ext);

  try {
    const [row] = await db
      .insert(mediaAssets)
      .values({
        filename,
        // Stored for display only; it never touches the filesystem.
        originalName: (file.name || "upload").slice(0, 255),
        mime: sniffed.mime,
        byteSize: buffer.length,
        width: sniffed.width,
        height: sniffed.height,
        checksumSha256: checksum,
        createdBy: c.get("session").userId,
      })
      .returning();

    if (!row) throw new Error("media insert returned no row");
    return c.json({ ok: true, media: toResponse(row) }, 201);
  } catch (error) {
    // Do not leave an orphan file behind if the row could not be written.
    await deleteMedia(filename);

    // Two uploads of the same new image at once: the other one won the unique
    // checksum, so this one is a dedupe rather than a failure.
    const winner = await findByChecksum();
    if (winner) {
      return c.json({ ok: true, deduped: true, media: toResponse(winner) });
    }
    throw error;
  }
});

adminMediaRouter.patch("/media/:id", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }

  const parsed = altInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);
  }

  const [row] = await getDb()
    .update(mediaAssets)
    .set({
      ...(parsed.data.altEn !== undefined ? { altEn: parsed.data.altEn } : {}),
      ...(parsed.data.altDe !== undefined ? { altDe: parsed.data.altDe } : {}),
    })
    .where(eq(mediaAssets.id, c.req.param("id")))
    .returning({ id: mediaAssets.id });

  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

adminMediaRouter.delete("/media/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb();

  const [asset] = await db
    .select({ id: mediaAssets.id, filename: mediaAssets.filename })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id))
    .limit(1);

  if (!asset) return c.json({ error: "not_found" }, 404);

  // Refuse rather than silently blanking a project's image. The FK is ON DELETE
  // SET NULL, so the database would allow this — the guard is the point.
  const usedBy = await findMediaUsage(asset.id, asset.filename);
  if (usedBy.length > 0) {
    return c.json({ error: "media_in_use", usedBy }, 409);
  }

  await db.delete(mediaAssets).where(eq(mediaAssets.id, id));
  await deleteMedia(asset.filename);
  return c.json({ ok: true });
});

/**
 * Database rows and files on disk can drift: a DB restore without a media
 * restore leaves rows with no file, and a failed delete leaves the reverse.
 * Surfaced on the dashboard so the drift is visible rather than discovered.
 */
adminMediaRouter.get("/media-reconcile", async (c) => {
  const rows = await listMediaAssets();
  const onDisk = new Set(await listMediaFiles());
  const known = new Set(rows.map((r) => r.filename));

  return c.json({
    missingFiles: rows.filter((r) => !onDisk.has(r.filename)).map((r) => r.filename),
    orphanFiles: [...onDisk].filter((name) => !known.has(name)),
    totalAssets: rows.length,
    totalBytes: rows.reduce((sum, r) => sum + r.byteSize, 0),
  });
});
