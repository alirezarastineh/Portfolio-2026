import { readFile } from "node:fs/promises";
import { and, asc, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { mediaAssets, mediaVariants } from "../db/schema.js";
import { processImage, variantFilename } from "./media-process.js";
import { sniffImage } from "./media-sniff.js";
import { deleteMedia, resolveMediaPath, restoreMedia, writeMediaFile } from "./media-store.js";

export interface ReprocessSummary {
  processed: string[];
  /** Rows whose file is not on disk (a DB restore without the media restore). */
  missing: string[];
  failed: { filename: string; error: string }[];
}

type AssetRow = typeof mediaAssets.$inferSelect;

async function readAssetBuffer(filename: string): Promise<Buffer | null> {
  const path = resolveMediaPath(filename);
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function writeAndPersistVariants(
  asset: AssetRow,
  result: Awaited<ReturnType<typeof processImage>>,
  db: ReturnType<typeof getDb>,
): Promise<void> {
  const written: string[] = [];
  try {
    const variants: (typeof mediaVariants.$inferInsert)[] = [];
    for (const variant of result.variants) {
      const name = variantFilename(asset.filename, variant.width, variant.format);
      await writeMediaFile(variant.buffer, name);
      written.push(name);
      variants.push({
        assetId: asset.id,
        format: variant.format,
        width: variant.width,
        height: variant.height,
        filename: name,
        byteSize: variant.buffer.length,
      });
    }

    await db.transaction(async (tx) => {
      if (variants.length) {
        await tx.insert(mediaVariants).values(variants).onConflictDoNothing();
      }
      await tx
        .update(mediaAssets)
        .set({
          byteSize: result.original.length,
          width: result.width,
          height: result.height,
          blurDataUri: result.blurDataUri,
        })
        .where(eq(mediaAssets.id, asset.id));
    });

    // Last, once the row describes it: an atomic rename over the old file,
    // so a visitor gets either the old bytes or the stripped ones.
    await restoreMedia(result.original, asset.filename);
  } catch (error) {
    for (const name of written) await deleteMedia(name);
    throw error;
  }
}

type AssetProcessResult =
  | { status: "missing" }
  | { status: "skipped" }
  | { status: "processed" }
  | { status: "failed"; error: string };

async function reprocessSingleAsset(asset: AssetRow, dryRun: boolean): Promise<AssetProcessResult> {
  const buffer = await readAssetBuffer(asset.filename);
  if (!buffer) {
    return { status: "missing" };
  }

  const sniffed = sniffImage(buffer);
  if (!sniffed || sniffed.ext === "gif") {
    return { status: "skipped" };
  }

  if (dryRun) {
    return { status: "processed" };
  }

  try {
    const result = await processImage(buffer, sniffed);
    await writeAndPersistVariants(asset, result, getDb());
    return { status: "processed" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Brings images uploaded before the media pipeline up to what an upload makes
 * today: EXIF (GPS included) stripped from the stored file, resized WebP/AVIF
 * variants, and a blur placeholder.
 *
 * Idempotent: an asset with a blur placeholder has been processed and is
 * skipped, so re-running only picks up what is left. GIFs are never processed
 * (see `processImage`). The filename and checksum stay the same, so every
 * published snapshot keeps pointing at it.
 */
export async function reprocessMedia(
  options: { dryRun?: boolean } = {},
): Promise<ReprocessSummary> {
  const db = getDb();
  const summary: ReprocessSummary = { processed: [], missing: [], failed: [] };

  const pending = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.kind, "image"), isNull(mediaAssets.blurDataUri)))
    .orderBy(asc(mediaAssets.createdAt));

  for (const asset of pending) {
    const res = await reprocessSingleAsset(asset, options.dryRun ?? false);
    if (res.status === "processed") {
      summary.processed.push(asset.filename);
    } else if (res.status === "missing") {
      summary.missing.push(asset.filename);
    } else if (res.status === "failed") {
      summary.failed.push({ filename: asset.filename, error: res.error });
    }
  }

  return summary;
}
