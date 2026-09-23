import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../db/client.js";
import { mediaAssets, mediaVariants } from "../db/schema.js";
import { resetDb } from "../test/helpers.js";
import { reprocessMedia } from "./media-reprocess.js";
import { resolveMediaPath, sha256, writeMediaFile } from "./media-store.js";

beforeEach(async () => {
  await resetDb();
});

/** An asset as the old upload route stored it: raw bytes, EXIF and all, no variants. */
async function legacyAsset(bytes: Buffer, ext: string): Promise<{ id: string; filename: string }> {
  const filename = `${randomUUID()}.${ext}`;
  await writeMediaFile(bytes, filename);
  const [row] = await getDb()
    .insert(mediaAssets)
    .values({
      filename,
      originalName: `legacy.${ext}`,
      mime: ext === "gif" ? "image/gif" : "image/jpeg",
      byteSize: bytes.length,
      checksumSha256: sha256(bytes),
    })
    .returning({ id: mediaAssets.id });
  return { id: row!.id, filename };
}

async function gpsPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 1000, height: 700, channels: 3, background: "#406080" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneCo" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 0/1" },
    })
    .toBuffer();
}

describe("reprocessMedia", () => {
  it("strips EXIF from an old upload and adds its variants and blur", async () => {
    const original = await gpsPhoto();
    const asset = await legacyAsset(original, "jpg");

    const summary = await reprocessMedia();
    expect(summary).toEqual({ processed: [asset.filename], missing: [], failed: [] });

    const stored = readFileSync(resolveMediaPath(asset.filename)!);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from("PhoneCo"))).toBe(false);

    const [row] = await getDb().select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
    expect(row).toMatchObject({ width: 1000, height: 700, byteSize: stored.length });
    expect(row!.blurDataUri).toMatch(/^data:image\/webp;base64,/);
    // The checksum is of the uploaded bytes and stays, so re-uploading still dedupes.
    expect(row!.checksumSha256.equals(sha256(original))).toBe(true);

    const variants = await getDb()
      .select()
      .from(mediaVariants)
      .where(eq(mediaVariants.assetId, asset.id));
    expect(variants.map((v) => `${v.format}:${v.width}`).sort()).toEqual([
      "avif:480",
      "avif:768",
      "webp:480",
      "webp:768",
    ]);
    for (const v of variants)
      expect(readFileSync(resolveMediaPath(v.filename)!)).toHaveLength(v.byteSize);
  });

  it("does nothing on a second run", async () => {
    await legacyAsset(await gpsPhoto(), "jpg");
    await reprocessMedia();
    expect(await reprocessMedia()).toEqual({ processed: [], missing: [], failed: [] });
  });

  it("changes nothing in a dry run", async () => {
    const original = await gpsPhoto();
    const asset = await legacyAsset(original, "jpg");

    const summary = await reprocessMedia({ dryRun: true });
    expect(summary.processed).toEqual([asset.filename]);
    expect(readFileSync(resolveMediaPath(asset.filename)!).equals(original)).toBe(true);
    expect(await getDb().select().from(mediaVariants)).toEqual([]);
  });

  it("reports rows whose file is gone instead of failing", async () => {
    const [row] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: `${randomUUID()}.png`,
        originalName: "gone.png",
        mime: "image/png",
        byteSize: 1,
        checksumSha256: Buffer.alloc(32, 7),
      })
      .returning({ filename: mediaAssets.filename });

    expect(await reprocessMedia()).toEqual({ processed: [], missing: [row!.filename], failed: [] });
  });

  it("leaves GIFs alone", async () => {
    const gif = await sharp({
      create: { width: 900, height: 500, channels: 3, background: "#0f0" },
    })
      .gif()
      .toBuffer();
    const asset = await legacyAsset(gif, "gif");

    expect((await reprocessMedia()).processed).toEqual([]);
    expect(readFileSync(resolveMediaPath(asset.filename)!).equals(gif)).toBe(true);
  });
});
