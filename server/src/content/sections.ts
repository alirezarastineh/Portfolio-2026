import { eq } from "drizzle-orm";
import { z } from "zod";

import { contentDocuments } from "../db/schema.js";
import { toIssues, type Issue } from "../lib/issues.js";
import type { DbExecutor } from "./build.js";
import { canonicalJson } from "./publish.js";
import { LOCALES, uiSchema, type Locale } from "./schema.js";

type Tx = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];

export type UiGroupName = keyof typeof uiSchema.shape;

/** One group of the `ui` document in both languages, as an editor sends it. */
export type UiGroups = Partial<Record<UiGroupName, Record<Locale, unknown>>>;

export type SectionSave =
  { ok: true; updatedAt: string } | { ok: false; reason: "stale"; current: string | null };

function isUiGroup(name: string): name is UiGroupName {
  return Object.hasOwn(uiSchema.shape, name);
}

/**
 * The newest `updated_at` of a section's rows is its concurrency token: an
 * editor echoes the one it loaded, and a save built on an older read is refused.
 */
function newest(rows: { updatedAt: Date }[]): Date | null {
  return rows.reduce<Date | null>(
    (acc, r) => (acc === null || r.updatedAt > acc ? r.updatedAt : acc),
    null,
  );
}

/** A token the client sent: an ISO string, or nothing (then there is nothing to check). */
export function expectedToken(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Writes a section's per-locale documents inside `tx`, refusing a stale save.
 *
 * The rows are locked first, so the version check and the write are one step:
 * two tabs saving at once cannot both pass the check. A locale whose document
 * did not change keeps its row — and its `updated_at` — untouched, which is
 * what lets the dashboard tell that the German text fell behind the English.
 */
export async function saveSection(
  tx: Tx,
  section: string,
  build: (current: Partial<Record<Locale, unknown>>) => Record<Locale, unknown>,
  expected: Date | null,
  userId: string,
): Promise<SectionSave> {
  const rows = await tx
    .select({
      locale: contentDocuments.locale,
      data: contentDocuments.data,
      updatedAt: contentDocuments.updatedAt,
    })
    .from(contentDocuments)
    .where(eq(contentDocuments.section, section))
    .for("update");

  const latest = newest(rows);
  if (latest && expected && latest.getTime() !== expected.getTime()) {
    return { ok: false, reason: "stale", current: latest.toISOString() };
  }

  const current = Object.fromEntries(rows.map((r) => [r.locale, r.data])) as Partial<
    Record<Locale, unknown>
  >;
  const next = build(current);
  const now = new Date();
  let written = false;

  for (const locale of LOCALES) {
    if (locale in current && canonicalJson(current[locale]) === canonicalJson(next[locale])) {
      continue;
    }
    written = true;
    await tx
      .insert(contentDocuments)
      .values({ section, locale, data: next[locale], updatedAt: now, updatedBy: userId })
      .onConflictDoUpdate({
        target: [contentDocuments.section, contentDocuments.locale],
        set: { data: next[locale], updatedAt: now, updatedBy: userId },
      });
  }

  // Nothing changed: the token the editor holds stays valid.
  const token = written ? now : latest;
  return { ok: true, updatedAt: (token ?? now).toISOString() };
}

const groupsInput = z.record(z.string(), z.object({ en: z.unknown(), de: z.unknown() }));

/**
 * Validates `{ group: { en, de } }` against the `ui` schema, group by group.
 * Issue paths are `[...prefix, group, locale, field]` — the shape the editor
 * sent — so each lands on its own field.
 */
export function parseUiGroups(
  value: unknown,
  prefix: (string | number)[],
): { ok: true; groups: UiGroups } | { ok: false; issues: Issue[] } {
  const shape = groupsInput.safeParse(value);
  if (!shape.success) return { ok: false, issues: toIssues(shape.error.issues, prefix) };

  const issues: Issue[] = [];
  const groups: UiGroups = {};
  for (const [name, locales] of Object.entries(shape.data)) {
    if (!isUiGroup(name)) {
      issues.push({ path: [...prefix, name], message: "Unknown group", code: "unknown_group" });
      continue;
    }
    const schema = uiSchema.shape[name];
    const parsed: Partial<Record<Locale, unknown>> = {};
    for (const locale of LOCALES) {
      const result = schema.safeParse(locales[locale]);
      if (result.success) parsed[locale] = result.data;
      else issues.push(...toIssues(result.error.issues, [...prefix, name, locale]));
    }
    groups[name] = parsed as Record<Locale, unknown>;
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, groups };
}

/**
 * Merges groups into the `ui` documents on the server, under the row lock:
 * an editor that owns one group can never overwrite another's, however stale
 * its copy of the rest.
 */
export function saveUiGroups(
  tx: Tx,
  groups: UiGroups,
  expected: Date | null,
  userId: string,
): Promise<SectionSave> {
  return saveSection(
    tx,
    "ui",
    (current) =>
      Object.fromEntries(
        LOCALES.map((locale) => {
          const base = (current[locale] ?? {}) as Record<string, unknown>;
          const merged = { ...base };
          for (const [name, value] of Object.entries(groups)) merged[name] = value[locale];
          return [locale, merged];
        }),
      ) as Record<Locale, unknown>,
    expected,
    userId,
  );
}
