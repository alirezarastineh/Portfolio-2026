export interface SniffedImage {
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
}

/**
 * Identifies an image from its bytes, ignoring the declared MIME type and the
 * filename entirely — both are attacker-controlled on an upload.
 *
 * SVG is deliberately absent. An SVG served from the API origin can carry
 * script, so accepting one would hand an uploader XSS on that origin. If SVG is
 * ever genuinely needed it belongs on a separate cookie-less host.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
  if (buffer.length < 16) return null;

  if (isPng(buffer)) {
    return { mime: "image/png", ext: "png", ...pngSize(buffer) };
  }
  if (isJpeg(buffer)) {
    return { mime: "image/jpeg", ext: "jpg", ...jpegSize(buffer) };
  }
  if (isWebp(buffer)) {
    return { mime: "image/webp", ext: "webp", ...webpSize(buffer) };
  }
  if (isGif(buffer)) {
    return { mime: "image/gif", ext: "gif", ...gifSize(buffer) };
  }
  if (isAvif(buffer)) {
    // Dimensions live in an ispe box; not worth a full ISOBMFF parser here.
    return { mime: "image/avif", ext: "avif", width: null, height: null };
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(b: Buffer): boolean {
  return b.subarray(0, 8).equals(PNG_SIGNATURE);
}

function isJpeg(b: Buffer): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isGif(b: Buffer): boolean {
  return b.toString("ascii", 0, 4) === "GIF8";
}

function isWebp(b: Buffer): boolean {
  return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
}

function isAvif(b: Buffer): boolean {
  if (b.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = b.toString("ascii", 8, 12);
  return brand === "avif" || brand === "avis";
}

function pngSize(b: Buffer): { width: number | null; height: number | null } {
  // IHDR is always the first chunk: width/height are big-endian at 16 and 20.
  // A truncated file shorter than that used to throw RangeError → a 500.
  if (b.length < 24) return { width: null, height: null };
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b: Buffer): { width: number | null; height: number | null } {
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b: Buffer): { width: number | null; height: number | null } {
  const format = b.toString("ascii", 12, 16);

  try {
    if (format === "VP8 ") {
      // Lossy: 14-bit dimensions after the 3-byte start code.
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (format === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (format === "VP8X") {
      // 24-bit little-endian, stored minus one.
      const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
      const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
      return { width, height };
    }
  } catch {
    // A truncated header should not fail the upload; the file is still valid.
  }
  return { width: null, height: null };
}

function jpegSize(b: Buffer): { width: number | null; height: number | null } {
  // Walk the marker segments to the start-of-frame, which carries the size.
  let offset = 2;

  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = b[offset + 1];

    // SOF0–SOF15, excluding the non-frame markers DHT/JPG/DAC.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isFrame) {
      return { width: b.readUInt16BE(offset + 7), height: b.readUInt16BE(offset + 5) };
    }

    // Standalone markers carry no length payload.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = b.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }

  return { width: null, height: null };
}

export interface SniffedDocument {
  mime: "application/pdf";
  ext: "pdf";
}

/**
 * PDFs, for the downloadable CV. Only the `%PDF-` header is checked: a PDF is
 * served as a download-or-view document, never parsed or rendered here.
 */
export function sniffDocument(buffer: Buffer): SniffedDocument | null {
  if (buffer.length < 8) return null;
  return buffer.toString("ascii", 0, 5) === "%PDF-"
    ? { mime: "application/pdf", ext: "pdf" }
    : null;
}

/**
 * Guards `GET /media/:name` — originals are `<uuid>.<ext>`, resized variants
 * `<uuid>-<width>w.<webp|avif>`.
 */
export const MEDIA_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d+w)?\.(png|jpe?g|webp|avif|gif|pdf)$/;

export function isSafeMediaFilename(name: string): boolean {
  return MEDIA_FILENAME_PATTERN.test(name);
}
