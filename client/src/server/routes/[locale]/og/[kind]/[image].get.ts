import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  sendRedirect,
  setResponseHeader,
  setResponseStatus,
} from "h3";
import { useStorage } from "nitropack/runtime";

import type { AppContent } from "../../../../../app/content/schema";
import { getContent, isLocale } from "../../../../utils/content-upstream";
import { ogCardFor, ogCardKey, renderOgPng, type OgFonts, type OgKind } from "../../../../utils/og";

const KINDS: readonly string[] = ["work", "writing"] satisfies OgKind[];
const IMAGE = /^([a-z0-9][a-z0-9-]*)\.png$/;

/** Rendered cards, by content hash; a restart keeps them, a new container starts over. */
const CACHE_DIR = join(tmpdir(), "portfolio-og");
const CACHE_LIMIT = 200;

let fonts: Promise<OgFonts> | undefined;
const rendering = new Map<string, Promise<Buffer>>();

/**
 * `/en/og/work/<slug>.png` and `/en/og/writing/<slug>.png`: the social card
 * for a case study or post (see utils/og.ts), which those pages name as their
 * `og:image`. Rendered on first request and kept on disk under a hash of what
 * it shows, so an edit publishes a new card at the same address. If rendering
 * fails, the site's default card is served instead.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");
  const kind = getRouterParam(event, "kind") ?? "";
  const slug = IMAGE.exec(getRouterParam(event, "image") ?? "")?.[1];
  if (!isLocale(locale) || !KINDS.includes(kind) || !slug) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const { payload } = await getContent(locale);
  const card = ogCardFor(payload as AppContent, locale, kind as OgKind, slug);
  if (!card) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const key = ogCardKey(card);
  const etag = `"og-${key}"`;
  if (getRequestHeader(event, "if-none-match") === etag) {
    setResponseStatus(event, 304);
    return "";
  }

  try {
    const png = await cached(key, async () => renderOgPng(card, await loadFonts()));
    setResponseHeader(event, "Content-Type", "image/png");
    setResponseHeader(event, "Cache-Control", "public, max-age=3600");
    setResponseHeader(event, "ETag", etag);
    return png;
  } catch (error) {
    console.error("[og] render failed", error);
    setResponseHeader(event, "Cache-Control", "no-store");
    return sendRedirect(event, "/og.png", 302);
  }
});

/** Geist, from src/server/assets/og (bundled into the server as Nitro server assets). */
function loadFonts(): Promise<OgFonts> {
  fonts ??= (async () => {
    const assets = useStorage("assets:server");
    const read = async (file: string) => {
      const raw = await assets.getItemRaw<Uint8Array>(`og/${file}`);
      if (!raw) throw new Error(`[og] missing server asset og/${file}`);
      return Buffer.from(raw);
    };
    return {
      regular: await read("geist-latin-400-normal.woff"),
      semibold: await read("geist-latin-600-normal.woff"),
      mono: await read("geist-mono-latin-500-normal.woff"),
    };
  })().catch((error: unknown) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}

/** From disk if rendered before; otherwise rendered once, however many ask at the same time. */
async function cached(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const file = join(CACHE_DIR, `${key}.png`);
  try {
    return await readFile(file);
  } catch {
    // Not rendered yet.
  }

  let job = rendering.get(key);
  if (!job) {
    job = render()
      .then(async (png) => {
        await store(file, png);
        return png;
      })
      .finally(() => rendering.delete(key));
    rendering.set(key, job);
  }
  return job;
}

/** Best effort: a full or read-only disk only costs a re-render next time. */
async function store(file: string, png: Buffer): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const partial = `${file}.${process.pid}.part`;
    await writeFile(partial, png);
    await rename(partial, file);
    await prune();
  } catch (error) {
    console.warn("[og] could not cache a card", error);
  }
}

/** Keeps the newest cards: old ones belong to content that has since changed. */
async function prune(): Promise<void> {
  const names = (await readdir(CACHE_DIR)).filter((name) => name.endsWith(".png"));
  if (names.length <= CACHE_LIMIT) return;
  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(CACHE_DIR, name);
      return { path, mtime: (await stat(path)).mtimeMs };
    }),
  );
  files.sort((a, b) => b.mtime - a.mtime);
  await Promise.all(files.slice(CACHE_LIMIT).map((f) => unlink(f.path).catch(() => undefined)));
}
