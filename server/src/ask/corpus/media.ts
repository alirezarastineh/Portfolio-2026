import { isNotNull, or } from "drizzle-orm";

import type { DbExecutor } from "../../content/build.js";
import type { Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import { mediaAssets } from "../../db/schema.js";

/**
 * The admin's descriptions of pictures (plan phase 17, multi-modal fusion):
 * what a diagram or screenshot shows, its parts and how they connect, by
 * media file. A chart is data in a visual wrapper; a diagram needs its
 * relations spelled out, which no alt text carries. Live on save, like the
 * FAQ: read every few seconds and part of the corpus key, so a saved
 * description reaches the next question; never sent to a visitor's page.
 */

export type ImageDescriptions = ReadonlyMap<string, Partial<Record<Locale, string>>>;

export const NO_DESCRIPTIONS: ImageDescriptions = new Map();

export async function readImageDescriptions(db: DbExecutor = getDb()): Promise<ImageDescriptions> {
  const rows = await db
    .select({
      file: mediaAssets.filename,
      en: mediaAssets.descriptionEn,
      de: mediaAssets.descriptionDe,
    })
    .from(mediaAssets)
    .where(or(isNotNull(mediaAssets.descriptionEn), isNotNull(mediaAssets.descriptionDe)));
  const found = new Map<string, Partial<Record<Locale, string>>>();
  for (const row of rows) {
    const texts = { en: row.en?.trim(), de: row.de?.trim() };
    const kept = Object.fromEntries(Object.entries(texts).filter(([, text]) => text));
    if (Object.keys(kept).length) found.set(row.file, kept);
  }
  return found;
}

const TTL_MS = 10_000;
let cache: { at: number; value: Promise<ImageDescriptions> } | undefined;

/** The descriptions, as of at most a few seconds ago (read on every question). */
export function imageDescriptions(now = Date.now()): Promise<ImageDescriptions> {
  if (!cache || now - cache.at > TTL_MS) {
    const value = readImageDescriptions();
    cache = { at: now, value };
    value.catch(() => {
      if (cache?.value === value) cache = undefined;
    });
  }
  return cache.value;
}

/** After the admin saves a description (same process). */
export function invalidateImageDescriptions(): void {
  cache = undefined;
}
