import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { getDb } from "../db/client.js";
import {
  contentPointers,
  contentPublications,
  contentVersions,
  mediaAssets,
  mediaVariants,
  versionMediaRefs,
} from "../db/schema.js";
import {
  ImageTooLargeError,
  MAX_INPUT_PIXELS,
  processImage,
  variantFilename,
} from "../lib/media-process.js";
import { sniffDocument, sniffImage } from "../lib/media-sniff.js";
import {
  deleteMedia,
  listMediaFiles,
  maxUploadBytes,
  mediaExists,
  restoreMedia,
  sha256,
  storeMedia,
  writeMediaFile,
} from "../lib/media-store.js";
import { findMediaUsage, listMediaAssets } from "./media.js";

export const adminMediaRouter = new Hono();

const altInput = z.object({
  altEn: z.string().max(300).nullable().optional(),
  altDe: z.string().max(300).nullable().optional(),
});

/** Publications this far back count as "recent" for the delete warning. */
const RECENT_PUBLICATIONS = 20;

function publicUrl(filename: string): string {
  let base = process.env.MEDIA_PUBLIC_BASE_URL ?? "";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return `${base}/media/${filename}`;
}

type VariantRow = typeof mediaVariants.$inferSelect;

/** The client's `MediaAsset` shape. Leaves out the raw checksum bytes. */
function toResponse(row: typeof mediaAssets.$inferSelect, variants: VariantRow[] = []) {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mime: row.mime,
    kind: row.kind,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    blurDataUri: row.blurDataUri,
    altEn: row.altEn,
    altDe: row.altDe,
    createdAt: row.createdAt,
    url: publicUrl(row.filename),
    path: `/media/${row.filename}`,
    variants: variants
      .filter((v) => v.assetId === row.id)
      .map((v) => ({
        format: v.format,
        width: v.width,
        height: v.height,
        path: `/media/${v.filename}`,
      })),
  };
}

adminMediaRouter.get("/media", async (c) => {
  const rows = await listMediaAssets();
  const variants = rows.length
    ? await getDb()
        .select()
        .from(mediaVariants)
        .where(
          inArray(
            mediaVariants.assetId,
            rows.map((r) => r.id),
          ),
        )
        // Smallest first, so the admin grid can take the first as a thumbnail.
        .orderBy(asc(mediaVariants.width))
    : [];
  return c.json({ media: rows.map((row) => toResponse(row, variants)) });
});

type ParsedUpload =
  | { ok: true; file: File; buffer: Buffer }
  | { ok: false; status: 400 | 413; payload: { error: string; limit?: number } };

async function parseUpload(
  req: { header: (name: string) => string | undefined; formData: () => Promise<FormData> },
  limit: number,
): Promise<ParsedUpload> {
  const declared = Number.parseInt(req.header("content-length") ?? "0", 10);
  if (Number.isFinite(declared) && declared > limit) {
    return { ok: false, status: 413, payload: { error: "file_too_large", limit } };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, status: 400, payload: { error: "invalid_upload" } };
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 400, payload: { error: "missing_file" } };
  }
  if (file.size > limit) {
    return { ok: false, status: 413, payload: { error: "file_too_large", limit } };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return { ok: true, file, buffer };
}

type SniffedMedia =
  | { kind: "image"; info: NonNullable<ReturnType<typeof sniffImage>> }
  | { kind: "document"; info: NonNullable<ReturnType<typeof sniffDocument>> };

function detectMedia(buffer: Buffer): SniffedMedia | null {
  const image = sniffImage(buffer);
  if (image) return { kind: "image", info: image };
  const document = sniffDocument(buffer);
  if (document) return { kind: "document", info: document };
  return null;
}

async function findAssetByChecksum(checksum: Buffer) {
  const [existing] = await getDb()
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.checksumSha256, checksum))
    .limit(1);
  return existing;
}

async function healMissingMedia(
  existingFilename: string,
  buffer: Buffer,
  media: SniffedMedia,
): Promise<void> {
  if (await mediaExists(existingFilename)) return;

  const healed =
    media.kind === "image"
      ? await processImage(buffer, media.info).then(
          (p) => p.original,
          () => buffer,
        )
      : buffer;
  await restoreMedia(healed, existingFilename);
}

type ProcessedMedia =
  | { ok: true; processed: Awaited<ReturnType<typeof processImage>> | null; stored: Buffer }
  | { ok: false; status: 413 | 415; payload: { error: string; maxPixels?: number } };

async function processUploadedMedia(buffer: Buffer, media: SniffedMedia): Promise<ProcessedMedia> {
  if (media.kind !== "image") {
    return { ok: true, processed: null, stored: buffer };
  }

  try {
    const processed = await processImage(buffer, media.info);
    return { ok: true, processed, stored: processed.original };
  } catch (error) {
    if (error instanceof ImageTooLargeError) {
      return {
        ok: false,
        status: 413,
        payload: { error: "image_too_large", maxPixels: MAX_INPUT_PIXELS },
      };
    }
    return { ok: false, status: 415, payload: { error: "unsupported_media_type" } };
  }
}

async function writeVariants(
  baseFilename: string,
  variants: NonNullable<Awaited<ReturnType<typeof processImage>>>["variants"],
) {
  const written: string[] = [];
  const variantRows: Omit<typeof mediaVariants.$inferInsert, "assetId">[] = [];

  for (const variant of variants) {
    const name = variantFilename(baseFilename, variant.width, variant.format);
    await writeMediaFile(variant.buffer, name);
    written.push(name);
    variantRows.push({
      format: variant.format,
      width: variant.width,
      height: variant.height,
      filename: name,
      byteSize: variant.buffer.length,
    });
  }

  return { written, variantRows };
}

async function insertMediaAssetWithVariants(params: {
  filename: string;
  originalName: string;
  mime: string;
  kind: "image" | "document";
  byteSize: number;
  width: number | null;
  height: number | null;
  blurDataUri: string | null;
  checksum: Buffer;
  userId: string;
  variants: Omit<typeof mediaVariants.$inferInsert, "assetId">[];
}) {
  return await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(mediaAssets)
      .values({
        filename: params.filename,
        originalName: params.originalName,
        mime: params.mime,
        kind: params.kind,
        byteSize: params.byteSize,
        width: params.width,
        height: params.height,
        blurDataUri: params.blurDataUri,
        checksumSha256: params.checksum,
        createdBy: params.userId,
      })
      .returning();
    if (!row) throw new Error("media insert returned no row");

    const variantRows = params.variants.length
      ? await tx
          .insert(mediaVariants)
          .values(params.variants.map((v) => ({ ...v, assetId: row.id })))
          .returning()
      : [];

    return { row, variantRows };
  });
}

adminMediaRouter.post("/media", async (c) => {
  const parsed = await parseUpload(c.req, maxUploadBytes());
  if (!parsed.ok) {
    return c.json(parsed.payload, parsed.status);
  }
  const { file, buffer } = parsed;

  const media = detectMedia(buffer);
  if (!media) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }

  const checksum = sha256(buffer);
  const existing = await findAssetByChecksum(checksum);
  if (existing) {
    await healMissingMedia(existing.filename, buffer, media);
    return c.json({ ok: true, deduped: true, media: toResponse(existing) });
  }

  const preparation = await processUploadedMedia(buffer, media);
  if (!preparation.ok) {
    return c.json(preparation.payload, preparation.status);
  }
  const { processed, stored } = preparation;

  const filename = await storeMedia(stored, media.info.ext);
  const written = [filename];

  try {
    const { written: variantFiles, variantRows } = await writeVariants(
      filename,
      processed?.variants ?? [],
    );
    written.push(...variantFiles);

    const { row, variantRows: savedVariants } = await insertMediaAssetWithVariants({
      filename,
      originalName: (file.name || "upload").slice(0, 255),
      mime: media.info.mime,
      kind: media.kind,
      byteSize: stored.length,
      width: processed?.width ?? null,
      height: processed?.height ?? null,
      blurDataUri: processed?.blurDataUri ?? null,
      checksum,
      userId: c.get("session").userId,
      variants: variantRows,
    });

    return c.json({ ok: true, media: toResponse(row, savedVariants) }, 201);
  } catch (error) {
    for (const name of written) await deleteMedia(name);

    const winner = await findAssetByChecksum(checksum);
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

/**
 * Deleting is refused, in order of how bad the breakage would be:
 *
 * 1. used by the draft (a project image, a pasted path) — the next publish
 *    would ship a broken image;
 * 2. shown by the live site right now — visitors would see it break at once;
 * 3. shown by one of the last 20 publications — a rollback to it would fail.
 *    Allowed with `?confirm=1`, since old history is not worth keeping every
 *    upload forever.
 *
 * All in one transaction that locks the asset row, so a publish cannot start
 * referencing it between the check and the delete.
 */
adminMediaRouter.delete("/media/:id", async (c) => {
  const id = c.req.param("id");
  const confirmed = c.req.query("confirm") === "1";

  const result = await getDb().transaction(async (tx) => {
    const [asset] = await tx
      .select({ id: mediaAssets.id, filename: mediaAssets.filename })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1)
      .for("update");
    if (!asset) return { status: 404 as const, body: { error: "not_found" } };

    const usedBy = await findMediaUsage(asset.id, asset.filename, tx);
    if (usedBy.length > 0) {
      return { status: 409 as const, body: { error: "media_in_use", usedBy } };
    }

    const live = await tx
      .select({ locale: contentPointers.locale })
      .from(versionMediaRefs)
      .innerJoin(contentPointers, eq(contentPointers.versionId, versionMediaRefs.versionId))
      .where(eq(versionMediaRefs.assetId, asset.id));
    if (live.length > 0) {
      return {
        status: 409 as const,
        body: { error: "media_in_use_live", locales: live.map((l) => l.locale) },
      };
    }

    if (!confirmed) {
      const recent = await tx
        .select({ id: contentPublications.id })
        .from(contentPublications)
        .orderBy(desc(contentPublications.id))
        .limit(RECENT_PUBLICATIONS);
      const inHistory = recent.length
        ? await tx
            .selectDistinct({ publicationId: contentVersions.publicationId })
            .from(versionMediaRefs)
            .innerJoin(contentVersions, eq(contentVersions.id, versionMediaRefs.versionId))
            .where(
              and(
                eq(versionMediaRefs.assetId, asset.id),
                inArray(
                  contentVersions.publicationId,
                  recent.map((r) => r.id),
                ),
              ),
            )
        : [];
      if (inHistory.length > 0) {
        return {
          status: 409 as const,
          body: {
            error: "media_in_history",
            publications: inHistory.map((p) => p.publicationId),
          },
        };
      }
    }

    const variants = await tx
      .select({ filename: mediaVariants.filename })
      .from(mediaVariants)
      .where(eq(mediaVariants.assetId, asset.id));
    // Variants and version refs go with it (ON DELETE CASCADE).
    await tx.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    return {
      status: 200 as const,
      body: { ok: true },
      files: [asset.filename, ...variants.map((v) => v.filename)],
    };
  });

  // Files only once the rows are gone for good: a rolled-back transaction must
  // not leave rows pointing at deleted files.
  if (result.status === 200) {
    for (const name of result.files) await deleteMedia(name);
  }
  return c.json(result.body, result.status);
});

/**
 * Database rows and files on disk can drift: a DB restore without a media
 * restore leaves rows with no file, and a failed delete leaves the reverse.
 * Surfaced on the dashboard so the drift is visible rather than discovered.
 */
adminMediaRouter.get("/media-reconcile", async (c) => {
  const rows = await listMediaAssets();
  const variants = await getDb().select({ filename: mediaVariants.filename }).from(mediaVariants);
  const onDisk = new Set(await listMediaFiles());
  const known = new Set([...rows.map((r) => r.filename), ...variants.map((v) => v.filename)]);

  return c.json({
    missingFiles: rows.filter((r) => !onDisk.has(r.filename)).map((r) => r.filename),
    orphanFiles: [...onDisk].filter((name) => !known.has(name)),
    totalAssets: rows.length,
    totalBytes: rows.reduce((sum, r) => sum + r.byteSize, 0),
  });
});
