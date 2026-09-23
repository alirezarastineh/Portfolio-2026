import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { getPool } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  contentPointers,
  contentPublications,
  contentVersionDocs,
  contentVersions,
  mediaAssets,
  mediaVariants,
  versionMediaRefs,
} from "../db/schema.js";
import { pgErrorCode } from "../lib/http-errors.js";
import { buildLocale, type BuiltLocale, type DbExecutor } from "./build.js";
import { invalidateContentCache } from "./cache.js";
import { CONTENT_SCHEMA_VERSION, LOCALES, type Locale } from "./schema.js";
import { payloadVersion, upcast, upcastDocs } from "./upcast.js";

export { CONTENT_SCHEMA_VERSION };

/** Arbitrary but fixed; the migration lock uses 8_741_203. */
const PUBLISH_LOCK_ID = 8_741_204;

/** Key-sorted JSON, so an identical payload always yields an identical hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
  const fields = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",");
  return `{${fields}}`;
}

export function checksumOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * One version's checksum covers its core and every doc, so editing only a
 * case-study body still counts as a change, and "nothing changed" means
 * nothing at all did.
 */
export function builtChecksum(built: BuiltLocale): string {
  const docs = Object.fromEntries([...built.docs].map(([key, doc]) => [key, checksumOf(doc)]));
  return checksumOf({ core: built.core, docs });
}

/** Every uploaded file a payload references: `/media/<name>` anywhere in it. */
export function mediaFilenamesIn(value: unknown): string[] {
  const names = new Set<string>();
  for (const match of JSON.stringify(value).matchAll(/\/media\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

/** Asset ids behind a set of original or variant filenames; unknown names are ignored. */
export async function assetIdsFor(
  db: DbExecutor,
  filenames: string[],
): Promise<{ ids: string[]; found: Set<string> }> {
  if (filenames.length === 0) return { ids: [], found: new Set() };
  const originals = await db
    .select({ id: mediaAssets.id, filename: mediaAssets.filename })
    .from(mediaAssets)
    .where(inArray(mediaAssets.filename, filenames));
  const variants = await db
    .select({ id: mediaVariants.assetId, filename: mediaVariants.filename })
    .from(mediaVariants)
    .where(inArray(mediaVariants.filename, filenames));
  const rows = [...originals, ...variants];
  return {
    ids: [...new Set(rows.map((r) => r.id))],
    found: new Set(rows.map((r) => r.filename)),
  };
}

export interface PublishResult {
  locale: Locale;
  versionId: number;
  checksum: string;
}

export interface PublishOutcome {
  /** Null when nothing changed and no publication was written. */
  publicationId: number | null;
  unchanged: boolean;
  results: PublishResult[];
}

/** A failure the admin should see as-is (status + machine-readable code). */
export class PublicationError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(code);
  }
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

type Tx = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];

/**
 * Runs `fn` in one REPEATABLE READ transaction while holding the publish lock.
 *
 * The lock is a session lock taken on a dedicated connection *before* BEGIN:
 * a transaction-level lock would be requested by the first statement, which is
 * also when a REPEATABLE READ snapshot is taken — so a publish that waited for
 * another one would then build from a snapshot older than that publish. Taken
 * first, the snapshot always postdates everything that held the lock before.
 *
 * REPEATABLE READ makes every locale build from the same moment, so an admin
 * save landing mid-publish cannot leave English and German built from
 * different drafts. One retry covers the rare serialization failure.
 */
async function withPublishLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let broken = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [PUBLISH_LOCK_ID]);
    const db = drizzle(client, { schema });
    for (let attempt = 1; ; attempt++) {
      try {
        return await db.transaction(fn, { isolationLevel: "repeatable read" });
      } catch (error) {
        // 40001 serialization_failure: a concurrent write touched what we read.
        if (attempt < 2 && pgErrorCode(error) === "40001") continue;
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [PUBLISH_LOCK_ID]);
    } catch {
      broken = true; // closing the connection releases the lock anyway
    }
    client.release(broken);
  }
}

/** Records which uploaded files a version shows, for delete protection. */
async function recordMediaRefs(tx: Tx, versionId: number, built: BuiltLocale): Promise<void> {
  const { ids } = await assetIdsFor(
    tx,
    mediaFilenamesIn({ core: built.core, docs: [...built.docs.values()] }),
  );
  if (ids.length === 0) return;
  await tx
    .insert(versionMediaRefs)
    .values(ids.map((assetId) => ({ versionId, assetId })))
    .onConflictDoNothing();
}

async function writeVersion(
  tx: Tx,
  options: {
    publicationId: number;
    locale: Locale;
    built: BuiltLocale;
    checksum: string;
    label: string | null;
    userId: string | null;
  },
): Promise<number> {
  const [version] = await tx
    .insert(contentVersions)
    .values({
      locale: options.locale,
      payload: options.built.core,
      checksum: options.checksum,
      label: options.label,
      publicationId: options.publicationId,
      createdBy: options.userId,
    })
    .returning({ id: contentVersions.id });
  if (!version) throw new Error(`failed to insert content version for "${options.locale}"`);

  if (options.built.docs.size > 0) {
    await tx.insert(contentVersionDocs).values(
      [...options.built.docs].map(([key, payload]) => ({
        versionId: version.id,
        key,
        payload,
        checksum: checksumOf(payload),
      })),
    );
  }

  await tx
    .insert(contentPointers)
    .values({ locale: options.locale, versionId: version.id, publishedBy: options.userId })
    .onConflictDoUpdate({
      target: contentPointers.locale,
      set: { versionId: version.id, publishedAt: new Date(), publishedBy: options.userId },
    });

  await recordMediaRefs(tx, version.id, options.built);
  return version.id;
}

/** Builds every locale from the draft at one moment (which scheduled posts are due). */
export async function buildAll(
  db: DbExecutor,
  now: Date = new Date(),
): Promise<{ locale: Locale; built: BuiltLocale; checksum: string }[]> {
  const out: { locale: Locale; built: BuiltLocale; checksum: string }[] = [];
  for (const locale of LOCALES) {
    const built = await buildLocale(db, locale, now);
    out.push({ locale, built, checksum: builtChecksum(built) });
  }
  return out;
}

/**
 * Publishes every locale as one publication.
 *
 * Both locales move together or neither does: a partial publish would leave
 * German pointing at content that English has already moved past. Validation
 * happens inside the transaction (in `buildLocale`), so a bad draft aborts
 * before any pointer changes and the previously published version stays live.
 *
 * A draft identical to what is live writes nothing: republishing it would only
 * pad the history with duplicates.
 */
export async function publishAll(
  options: { label?: string; userId?: string } = {},
): Promise<PublishOutcome> {
  const label = options.label?.trim() || null;
  const userId = options.userId ?? null;

  const outcome = await withPublishLock(async (tx) => {
    const built = await buildAll(tx);

    const live = await tx
      .select({
        locale: contentPointers.locale,
        versionId: contentPointers.versionId,
        checksum: contentVersions.checksum,
      })
      .from(contentPointers)
      .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId));

    const liveFor = (locale: Locale) => live.find((row) => row.locale === locale);
    if (built.every((b) => liveFor(b.locale)?.checksum === b.checksum)) {
      return {
        publicationId: null,
        unchanged: true,
        results: built.map((b) => ({
          locale: b.locale,
          versionId: liveFor(b.locale)!.versionId,
          checksum: b.checksum,
        })),
      } satisfies PublishOutcome;
    }

    const [publication] = await tx
      .insert(contentPublications)
      .values({ kind: "publish", label, schemaVersion: CONTENT_SCHEMA_VERSION, createdBy: userId })
      .returning({ id: contentPublications.id });
    if (!publication) throw new Error("failed to insert publication");

    const results: PublishResult[] = [];
    for (const b of built) {
      const versionId = await writeVersion(tx, {
        publicationId: publication.id,
        locale: b.locale,
        built: b.built,
        checksum: b.checksum,
        label,
        userId,
      });
      results.push({ locale: b.locale, versionId, checksum: b.checksum });
    }
    return { publicationId: publication.id, unchanged: false, results } satisfies PublishOutcome;
  });

  if (!outcome.unchanged) {
    // Only after the transaction commits — invalidating earlier could repopulate
    // the cache from a snapshot that then rolled back.
    invalidateContentCache();
    await notifyClientCache();
  }
  return outcome;
}

export interface LoadedVersion {
  versionId: number;
  locale: Locale;
  /** The payload's own version: 1 for snapshots published before v2. */
  from: number;
  built: BuiltLocale;
}

/**
 * Every locale of a publication as v2, docs included — old v1 versions are
 * upcast. Refuses (422) a payload that no longer validates.
 */
export async function loadPublication(
  db: DbExecutor,
  publicationId: number,
): Promise<LoadedVersion[]> {
  const versions = await db
    .select({
      id: contentVersions.id,
      locale: contentVersions.locale,
      payload: contentVersions.payload,
      createdAt: contentVersions.createdAt,
    })
    .from(contentVersions)
    .where(eq(contentVersions.publicationId, publicationId));
  if (versions.length === 0) throw new PublicationError(404, "not_found");

  const docRows = await db
    .select({
      versionId: contentVersionDocs.versionId,
      key: contentVersionDocs.key,
      payload: contentVersionDocs.payload,
    })
    .from(contentVersionDocs)
    .where(
      inArray(
        contentVersionDocs.versionId,
        versions.map((v) => v.id),
      ),
    );

  const loaded: LoadedVersion[] = [];
  for (const version of versions) {
    const result = upcast(version.payload, version.createdAt.toISOString());
    if (!result.ok) {
      throw new PublicationError(422, "invalid_payload", {
        locale: version.locale,
        issues: result.issues,
      });
    }
    let docs;
    try {
      docs = await upcastDocs(
        payloadVersion(version.payload) ?? CONTENT_SCHEMA_VERSION,
        version.locale,
        docRows.filter((d) => d.versionId === version.id),
      );
    } catch (error) {
      throw new PublicationError(422, "invalid_payload", {
        locale: version.locale,
        issues: String(error),
      });
    }
    loaded.push({
      versionId: version.id,
      locale: version.locale,
      from: result.from,
      built: { core: result.content, docs },
    });
  }
  return loaded;
}

export interface RollbackOutcome {
  publicationId: number;
  restoredFrom: number;
  results: PublishResult[];
}

/**
 * Makes an earlier publication live again, by copying its versions into a new
 * publication — history stays append-only, and the state being rolled back
 * from remains inspectable and restorable.
 *
 * Every locale of the source publication moves together. The old payloads are
 * upcast and re-validated against today's schema first, and refused if a file
 * they show has since been deleted: either would put a broken page live.
 */
export async function rollbackToPublication(
  sourceId: number,
  userId?: string,
): Promise<RollbackOutcome> {
  const outcome = await withPublishLock(async (tx) => {
    const sources = await loadPublication(tx, sourceId);

    const wanted = [
      ...new Set(
        sources.flatMap((s) =>
          mediaFilenamesIn({ core: s.built.core, docs: [...s.built.docs.values()] }),
        ),
      ),
    ];
    const { found } = await assetIdsFor(tx, wanted);
    const missing = wanted.filter((name) => !found.has(name));
    if (missing.length > 0) throw new PublicationError(409, "media_missing", { missing });

    const label = `rollback to publication #${sourceId}`;
    const [publication] = await tx
      .insert(contentPublications)
      .values({
        kind: "rollback",
        label,
        schemaVersion: CONTENT_SCHEMA_VERSION,
        restoredFrom: sourceId,
        createdBy: userId ?? null,
      })
      .returning({ id: contentPublications.id });
    if (!publication) throw new Error("failed to insert publication");

    const results: PublishResult[] = [];
    for (const source of sources) {
      const checksum = builtChecksum(source.built);
      const versionId = await writeVersion(tx, {
        publicationId: publication.id,
        locale: source.locale,
        built: source.built,
        checksum,
        label,
        userId: userId ?? null,
      });
      results.push({ locale: source.locale, versionId, checksum });
    }
    return { publicationId: publication.id, restoredFrom: sourceId, results };
  });

  // Both cache tiers, exactly as a publish does.
  invalidateContentCache();
  await notifyClientCache();
  return outcome;
}
