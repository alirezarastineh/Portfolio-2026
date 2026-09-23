import sharp from "sharp";

import type { SniffedImage } from "./media-sniff.js";

/** sharp's `export =` typings do not expose the `sharp.Sharp` namespace to an ESM default import. */
type SharpImage = ReturnType<typeof sharp>;

// One libvips thread and no operation cache: uploads are rare, and the API
// container has 512 MB and one core to share with everything else.
sharp.concurrency(1);
sharp.cache(false);

/**
 * 50 megapixels: a 48 MP phone photo fits. Above that, a small file can still
 * decode to hundreds of MB (a "decompression bomb") and get the 512 MB API
 * container killed, so it is refused before decoding.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

export class ImageTooLargeError extends Error {
  constructor(readonly pixels: number) {
    super(`image has ${pixels} pixels, over the ${MAX_INPUT_PIXELS} limit`);
  }
}

/** Responsive widths. None is made larger than the original. */
export const VARIANT_WIDTHS = [480, 768, 1200, 1600, 2400] as const;
export type VariantFormat = "webp" | "avif";

export interface ProcessedVariant {
  format: VariantFormat;
  width: number;
  height: number;
  buffer: Buffer;
}

export interface ProcessedImage {
  /** Upright and re-encoded, so EXIF — GPS position included — is gone. */
  original: Buffer;
  width: number | null;
  height: number | null;
  /** ~16px-wide blurred WebP as a data: URI; null for GIFs. */
  blurDataUri: string | null;
  variants: ProcessedVariant[];
}

/**
 * Serialized: each upload is processed after the previous one finishes, so a
 * burst of uploads queues instead of multiplying memory use. AVIF encoding is
 * the slow part; effort 2 keeps a large photo to a few seconds.
 */
let queue: Promise<unknown> = Promise.resolve();

export function processImage(buffer: Buffer, sniffed: SniffedImage): Promise<ProcessedImage> {
  const run = queue.then(() => processNow(buffer, sniffed));
  queue = run.catch(() => undefined);
  return run;
}

async function processNow(buffer: Buffer, sniffed: SniffedImage): Promise<ProcessedImage> {
  // Animated GIFs would lose their frames in a resize; they are kept as-is.
  if (sniffed.ext === "gif") {
    return {
      original: buffer,
      width: sniffed.width,
      height: sniffed.height,
      blurDataUri: null,
      variants: [],
    };
  }

  // The header alone, so the size check costs nothing.
  const header = await sharp(buffer).metadata();
  const pixels = (header.width ?? 0) * (header.height ?? 0);
  if (pixels > MAX_INPUT_PIXELS) throw new ImageTooLargeError(pixels);

  // `rotate()` with no angle applies the EXIF orientation, then output is
  // written without metadata (sharp's default), which is what strips EXIF.
  const upright = sharp(buffer, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const original = await reencode(upright.clone(), sniffed.ext).toBuffer();
  const { width, height } = await sharp(original).metadata();

  const variants: ProcessedVariant[] = [];
  for (const target of VARIANT_WIDTHS) {
    if (!width || target >= width) continue;
    for (const format of ["webp", "avif"] as const) {
      const resized = sharp(original).resize({ width: target });
      const encoded =
        format === "webp"
          ? resized.webp({ quality: 78 })
          : resized.avif({ quality: 55, effort: 2 });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      variants.push({ format, width: info.width, height: info.height, buffer: data });
    }
  }

  const blur = await sharp(original).resize({ width: 16 }).blur().webp({ quality: 40 }).toBuffer();

  return {
    original,
    width: width ?? null,
    height: height ?? null,
    blurDataUri: `data:image/webp;base64,${blur.toString("base64")}`,
    variants,
  };
}

/** Same format as uploaded, high quality: this is the file the variants come from. */
function reencode(image: SharpImage, ext: string): SharpImage {
  switch (ext) {
    case "jpg":
      return image.jpeg({ quality: 90, mozjpeg: true });
    case "png":
      return image.png({ compressionLevel: 9 });
    case "webp":
      return image.webp({ quality: 90 });
    case "avif":
      return image.avif({ quality: 70, effort: 2 });
    default:
      throw new Error(`cannot re-encode .${ext}`);
  }
}

export function variantFilename(
  assetFilename: string,
  width: number,
  format: VariantFormat,
): string {
  const base = assetFilename.replace(/\.[a-z0-9]+$/, "");
  return `${base}-${width}w.${format}`;
}
