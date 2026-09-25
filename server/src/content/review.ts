import { eq } from "drizzle-orm";

import { contentPointers, contentVersionDocs, contentVersions } from "../db/schema.js";
import { buildLocale, type BuiltLocale, type DbExecutor } from "./build.js";
import { DraftInvalidError, type DraftIssue } from "./draft-issues.js";
import { builtChecksum, checksumOf } from "./publish.js";
import {
  CONTENT_SCHEMA_VERSION,
  LOCALES,
  type AppContent,
  type Doc,
  type Locale,
} from "./schema.js";
import { payloadVersion, upcast, upcastDocs } from "./upcast.js";

/** A long-form body that publishing would add, change or take off the site. */
export interface DocChange {
  key: string;
  change: "added" | "removed" | "changed";
  draft: Doc | null;
  live: Doc | null;
}

/** What publishing would do to one locale — or why it cannot. */
export interface LocaleReview {
  locale: Locale;
  /** Empty when the draft is publishable. */
  issues: DraftIssue[];
  /** The draft differs from what is live (or cannot be built, or nothing is live yet). */
  changed: boolean;
  /** Core payloads, both as v2; the admin diffs them. `draft` is null when invalid. */
  draft: AppContent | null;
  live: AppContent | null;
  liveVersionId: number | null;
  /** Only the docs that differ, with both sides. */
  docs: DocChange[];
}

interface LiveVersion {
  versionId: number;
  checksum: string;
  built: BuiltLocale;
}

/** The live version of a locale as v2, docs included; null before the first publish. */
async function loadLive(db: DbExecutor, locale: Locale): Promise<LiveVersion | null> {
  const [row] = await db
    .select({
      versionId: contentVersions.id,
      checksum: contentVersions.checksum,
      payload: contentVersions.payload,
      publishedAt: contentPointers.publishedAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId))
    .where(eq(contentPointers.locale, locale))
    .limit(1);
  if (!row) return null;

  const core = upcast(row.payload, row.publishedAt.toISOString());
  if (!core.ok) return null;
  const stored = await db
    .select({ key: contentVersionDocs.key, payload: contentVersionDocs.payload })
    .from(contentVersionDocs)
    .where(eq(contentVersionDocs.versionId, row.versionId));
  const docs = await upcastDocs(
    payloadVersion(row.payload) ?? CONTENT_SCHEMA_VERSION,
    locale,
    stored,
  );
  return { versionId: row.versionId, checksum: row.checksum, built: { core: core.content, docs } };
}

function docChanges(draft: Map<string, Doc>, live: Map<string, Doc>): DocChange[] {
  const keys = [...new Set([...live.keys(), ...draft.keys()])].sort((a, b) => a.localeCompare(b));
  const changes: DocChange[] = [];
  for (const key of keys) {
    const before = live.get(key) ?? null;
    const after = draft.get(key) ?? null;
    if (before && after) {
      if (checksumOf(before) !== checksumOf(after)) {
        changes.push({ key, change: "changed", draft: after, live: before });
      }
    } else if (after) {
      changes.push({ key, change: "added", draft: after, live: null });
    } else {
      changes.push({ key, change: "removed", draft: null, live: before });
    }
  }
  return changes;
}

/**
 * Draft against live, per locale, as the publish dialog shows it. Built the
 * way a publish builds (same moment for both locales, the same checksum), so
 * "nothing changed" here means a publish would write nothing either.
 */
export async function reviewDraft(db: DbExecutor, now: Date = new Date()): Promise<LocaleReview[]> {
  const reviews: LocaleReview[] = [];
  for (const locale of LOCALES) {
    let built: BuiltLocale | null = null;
    let issues: DraftIssue[] = [];
    try {
      built = await buildLocale(db, locale, now);
    } catch (error) {
      if (!(error instanceof DraftInvalidError)) throw error;
      issues = error.issues;
    }

    const live = await loadLive(db, locale);
    reviews.push({
      locale,
      issues,
      changed: !built || builtChecksum(built) !== live?.checksum,
      draft: built?.core ?? null,
      live: live?.built.core ?? null,
      liveVersionId: live?.versionId ?? null,
      docs: built ? docChanges(built.docs, live?.built.docs ?? new Map()) : [],
    });
  }
  return reviews;
}
