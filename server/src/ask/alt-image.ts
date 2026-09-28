import { readFile } from "node:fs/promises";

import { asc, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { mediaAssets, mediaVariants } from "../db/schema.js";
import { resolveMediaPath } from "../lib/media-store.js";

/** Wide enough to read what is in the picture; small enough to send cheaply. */
const PREFERRED_WIDTH = 1024;
/** An original sent as it is (no resized copy exists) must stay under this. */
const MAX_ORIGINAL_BYTES = 4 * 1024 * 1024;
/** What the vision models take as an image part. */
const SENDABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type AltImage =
  | { ok: true; image: Buffer; mediaType: string; name: string }
  | { ok: false; error: "not_found" | "not_an_image" | "unreadable" };

/**
 * The picture the copilot looks at to suggest alt text for an uploaded image:
 * its largest resized WebP up to 1024 px wide (the smallest when all are
 * wider), or the original when it has none and is small and in a format a
 * model takes. Read from the media directory; nothing is fetched.
 */
export async function altImage(mediaId: string): Promise<AltImage> {
  const db = getDb();
  const [asset] = await db
    .select({
      filename: mediaAssets.filename,
      kind: mediaAssets.kind,
      mime: mediaAssets.mime,
      byteSize: mediaAssets.byteSize,
      originalName: mediaAssets.originalName,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, mediaId))
    .limit(1);
  if (!asset) return { ok: false, error: "not_found" };
  if (asset.kind !== "image") return { ok: false, error: "not_an_image" };

  const webp = await db
    .select({ filename: mediaVariants.filename, width: mediaVariants.width })
    .from(mediaVariants)
    .where(eq(mediaVariants.assetId, mediaId))
    .orderBy(asc(mediaVariants.width))
    .then((rows) => rows.filter((row) => row.filename.endsWith(".webp")));
  const variant = webp.findLast((v) => v.width <= PREFERRED_WIDTH) ?? webp[0];

  let pick: { filename: string; mediaType: string } | null = null;
  if (variant) pick = { filename: variant.filename, mediaType: "image/webp" };
  else if (SENDABLE.has(asset.mime) && asset.byteSize <= MAX_ORIGINAL_BYTES) {
    pick = { filename: asset.filename, mediaType: asset.mime };
  }
  const path = pick ? resolveMediaPath(pick.filename) : null;
  if (!pick || !path) return { ok: false, error: "unreadable" };
  try {
    return {
      ok: true,
      image: await readFile(path),
      mediaType: pick.mediaType,
      name: asset.originalName,
    };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}
