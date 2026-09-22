import { createHash } from "node:crypto";

import { getDb } from "../db/client.js";
import { contentPointers, contentVersions } from "../db/schema.js";
import { buildContent } from "./build.js";
import { invalidateContentCache } from "./cache.js";
import { LOCALES, type AppContent, type Locale } from "./schema.js";

/** Key-sorted JSON, so an identical payload always yields an identical hash. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const fields = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",");
  return `{${fields}}`;
}

export function checksumOf(content: AppContent): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export interface PublishResult {
  locale: Locale;
  versionId: number;
  checksum: string;
}

/**
 * Tells the SSR container to drop its cached copy, so an edit is live in ~0s
 * instead of waiting out the BFF's TTL. Omit `locale` to drop both.
 *
 * Best-effort by design: the TTL is the floor, so a failure here delays the
 * change rather than losing it. Never let it fail a publish that already
 * committed.
 */
export async function notifyClientCache(locale?: Locale): Promise<void> {
  const url = process.env.CONTENT_INVALIDATE_URL;
  const token = process.env.CONTENT_INVALIDATE_TOKEN;
  if (!url || !token) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(locale ? { locale } : {}),
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) {
      console.error(`[publish] client cache invalidation returned ${response.status}`);
    }
  } catch (error) {
    console.error("[publish] client cache invalidation failed", error);
  }
}

/**
 * Publishes every locale in one transaction.
 *
 * Both locales move together or neither does: a partial publish would leave
 * German pointing at content that English has already moved past. Validation
 * happens inside the transaction (in `buildContent`), so a bad draft aborts
 * before any pointer changes and the previously published version stays live.
 */
export async function publishAll(
  options: { label?: string; userId?: string } = {},
): Promise<PublishResult[]> {
  const db = getDb();

  const results = await db.transaction(async (tx) => {
    const results: PublishResult[] = [];

    for (const locale of LOCALES) {
      const content = await buildContent(tx, locale);
      const checksum = checksumOf(content);

      const [version] = await tx
        .insert(contentVersions)
        .values({
          locale,
          payload: content,
          checksum,
          label: options.label ?? null,
          createdBy: options.userId ?? null,
        })
        .returning({ id: contentVersions.id });

      if (!version) {
        throw new Error(`failed to insert content version for "${locale}"`);
      }

      await tx
        .insert(contentPointers)
        .values({
          locale,
          versionId: version.id,
          publishedBy: options.userId ?? null,
        })
        .onConflictDoUpdate({
          target: contentPointers.locale,
          set: {
            versionId: version.id,
            publishedAt: new Date(),
            publishedBy: options.userId ?? null,
          },
        });

      results.push({ locale, versionId: version.id, checksum });
    }

    return results;
  });

  // Only after the transaction commits — invalidating earlier could repopulate
  // the cache from a snapshot that then rolled back.
  invalidateContentCache();
  await notifyClientCache();

  return results;
}
