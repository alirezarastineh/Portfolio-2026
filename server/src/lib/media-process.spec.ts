import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  ImageTooLargeError,
  processImage,
  variantFilename,
  VARIANT_WIDTHS,
} from "./media-process.js";
import { sniffImage } from "./media-sniff.js";

/** A JPEG as a phone makes it: EXIF with GPS, stored sideways with an orientation tag. */
async function phonePhoto(width: number, height: number): Promise<Buffer> {
  // `withExif` cannot set the orientation tag; `withMetadata` does, and the
  // merge adds the camera and GPS fields on top.
  return sharp({ create: { width, height, channels: 3, background: "#3366ff" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: "PhoneCo" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "52/1 31/1 0/1" },
    })
    .toBuffer();
}

async function process(buffer: Buffer) {
  const sniffed = sniffImage(buffer);
  if (!sniffed) throw new Error("not an image");
  return processImage(buffer, sniffed);
}

describe("processImage", () => {
  it("strips EXIF, GPS included", async () => {
    const input = await phonePhoto(1000, 600);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    expect(input.includes(Buffer.from("PhoneCo"))).toBe(true);

    const { original } = await process(input);
    const meta = await sharp(original).metadata();
    expect(meta.exif).toBeUndefined();
    expect(original.includes(Buffer.from("PhoneCo"))).toBe(false);
  });

  /** Orientation 6 = rotate 90°: the stored 1000×600 is displayed 600×1000. */
  it("applies the orientation tag, so the result is upright without it", async () => {
    const { width, height } = await process(await phonePhoto(1000, 600));
    expect({ width, height }).toEqual({ width: 600, height: 1000 });
  });

  it("makes WebP and AVIF copies at every standard width below the original", async () => {
    const input = await sharp({
      create: { width: 1300, height: 700, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const { variants } = await process(input);

    const expected = VARIANT_WIDTHS.filter((w) => w < 1300);
    for (const format of ["webp", "avif"] as const) {
      expect(variants.filter((v) => v.format === format).map((v) => v.width)).toEqual(expected);
    }
    // Proportional height, and really the named format.
    const webp768 = variants.find((v) => v.format === "webp" && v.width === 768)!;
    expect(webp768.height).toBe(Math.round((700 * 768) / 1300));
    expect((await sharp(webp768.buffer).metadata()).format).toBe("webp");
  });

  it("never upscales a small image", async () => {
    const input = await sharp({
      create: { width: 300, height: 200, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    expect((await process(input)).variants).toEqual([]);
  });

  it("produces a tiny blur placeholder as a data URI", async () => {
    const { blurDataUri } = await process(await phonePhoto(800, 800));
    expect(blurDataUri).toMatch(/^data:image\/webp;base64,/);
    expect(blurDataUri!.length).toBeLessThan(1500);
  });

  /** A tiny file whose header claims 10000×10000: refused before it is decoded. */
  it("refuses an image over the pixel limit without decoding it", async () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(10_000, 0);
    ihdr.writeUInt32BE(10_000, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      // A sliver of pixel data, far short of 10000×10000: the point is the header.
      chunk("IDAT", deflateSync(Buffer.alloc(1024))),
      chunk("IEND", Buffer.alloc(0)),
    ]);

    await expect(process(bomb)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("keeps GIFs untouched, since resizing would drop their animation", async () => {
    const gif = await sharp({
      create: { width: 900, height: 500, channels: 3, background: "#0f0" },
    })
      .gif()
      .toBuffer();
    const result = await process(gif);
    expect(result.original.equals(gif)).toBe(true);
    expect(result.variants).toEqual([]);
  });
});

describe("variantFilename", () => {
  it("derives the variant name from the asset's", () => {
    expect(variantFilename("0b1d7c3e-1111-4000-8000-000000000000.jpg", 768, "avif")).toBe(
      "0b1d7c3e-1111-4000-8000-000000000000-768w.avif",
    );
  });
});
