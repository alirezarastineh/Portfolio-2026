import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export function mediaRoot(): string {
  return resolve(process.env.MEDIA_ROOT ?? "./.media");
}

export function maxUploadBytes(): number {
  // 10 MiB: a full-size phone photo or a CV PDF. Deliberately under the 11MB
  // Caddy allows on the upload route, so the rejection is our JSON error rather
  // than Caddy's HTML 413.
  return Number.parseInt(process.env.MEDIA_MAX_BYTES ?? "10485760", 10);
}

/**
 * Resolves a stored filename to an absolute path, refusing anything that
 * escapes the media root. The filename pattern already forbids separators, but
 * this is the check that actually guarantees containment.
 */
export function resolveMediaPath(filename: string): string | null {
  const root = mediaRoot();
  const full = resolve(root, filename);
  return full.startsWith(root + sep) ? full : null;
}

export async function ensureMediaDirs(): Promise<void> {
  await mkdir(join(mediaRoot(), "tmp"), { recursive: true });
}

export function sha256(buffer: Buffer): Buffer {
  return createHash("sha256").update(buffer).digest();
}

/**
 * Writes to a temp file on the same volume, then renames into place. A rename
 * within a filesystem is atomic, so a reader can never observe a half-written
 * image at its final path.
 */
async function writeAtomically(buffer: Buffer, filename: string): Promise<void> {
  const target = resolveMediaPath(filename);
  if (!target) throw new Error("refusing to write outside the media root");

  await ensureMediaDirs();
  const temp = join(mediaRoot(), "tmp", `${randomUUID()}.part`);
  await writeFile(temp, buffer);
  await rename(temp, target);
}

export async function storeMedia(buffer: Buffer, ext: string): Promise<string> {
  const filename = `${randomUUID()}.${ext}`;
  await writeAtomically(buffer, filename);
  return filename;
}

/** For derived files (resized variants) whose name is decided by the caller. */
export async function writeMediaFile(buffer: Buffer, filename: string): Promise<void> {
  await writeAtomically(buffer, filename);
}

/**
 * Half-written uploads left by a crash mid-write. Run at boot, before anything
 * can be writing: a single API instance owns the media volume.
 */
export async function cleanupPartialUploads(): Promise<number> {
  const tmp = join(mediaRoot(), "tmp");
  let removed = 0;
  try {
    for (const entry of await readdir(tmp)) {
      if (!entry.endsWith(".part")) continue;
      await rm(join(tmp, entry), { force: true });
      removed++;
    }
  } catch {
    // No tmp directory yet: nothing to clean.
  }
  return removed;
}

/**
 * Puts bytes back under an existing asset's filename. For a row that outlived
 * its file — a database restore without the matching media restore. The
 * caller has matched the checksum, so these are provably the same bytes.
 */
export async function restoreMedia(buffer: Buffer, filename: string): Promise<void> {
  await writeAtomically(buffer, filename);
}

export async function deleteMedia(filename: string): Promise<void> {
  const path = resolveMediaPath(filename);
  if (!path) return;
  await rm(path, { force: true });
}

export function openMedia(filename: string): NodeJS.ReadableStream | null {
  const path = resolveMediaPath(filename);
  return path ? createReadStream(path) : null;
}

export async function mediaExists(filename: string): Promise<boolean> {
  const path = resolveMediaPath(filename);
  if (!path) return false;

  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Files actually on disk, ignoring the tmp staging directory. */
export async function listMediaFiles(): Promise<string[]> {
  try {
    const entries = await readdir(mediaRoot(), { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
