import type { Locale } from "../content/schema";
import type { DocChange, LocaleReview, PublishReview } from "./admin-api.service";
import { diffJson, type DiffEntry, type DiffKind } from "./json-diff";

/** What publishing now would do in one language. */
export interface LocaleSummary {
  locale: Locale;
  /** Fields and pages visitors would see change; 0 when nothing would. */
  changes: number;
  /** Problems that stop this language from publishing. */
  issues: number;
}

export interface PublishSummary {
  locales: LocaleSummary[];
  /** Changes in every language together. */
  total: number;
  issues: number;
  canPublish: boolean;
}

/**
 * One change as the review lists it (plan 5, U16): a field, an item added or removed whole, a list's
 * order, or an item's own page (a doc).
 */
export interface ChangeRow {
  /** `ui.about.bio`, `projects[atlas].cover`, `projects[atlas]`, `projects (order)`, or a doc's key. */
  path: string;
  kind: DiffKind;
  /** The differences behind it, for "Show the data"; a doc's are its own. */
  entries: DiffEntry[];
  doc?: DocChange;
}

/** An item of a list keyed by slug or id (`json-diff`'s naming): its root and key. */
export const ITEM = /^(projects|posts|experiences|skills)\[([^\]]+)\]/;
const KEYED = /^(?:projects|posts|experiences|skills)$/;
const IMAGE_PART = /\.(?:src|srcset|sources|width|height|blur)$/;

/** The field a path belongs to: an image's parts are the image, an item of a list without ids the list. */
export function fieldOf(path: string): string {
  if (path.startsWith("ui.")) {
    return path;
  }
  const item = ITEM.exec(path)?.[0] ?? "";
  return (
    item +
    path
      .slice(item.length)
      .replace(/\[\d+\].*$/, "")
      .replace(IMAGE_PART, "")
  );
}

function holds(content: unknown, root: string, key: string): boolean {
  const list = (content as Record<string, unknown> | null)?.[root];
  return (
    Array.isArray(list) &&
    list.some((item: { slug?: unknown; id?: unknown }) => (item?.slug ?? item?.id) === key)
  );
}

/** Live against the draft, one row per field a person would name; nothing is dropped. */
export function changeRows(
  live: unknown,
  draft: unknown,
  docs: readonly DocChange[] = [],
): ChangeRow[] {
  const rows = new Map<string, ChangeRow>();
  for (const entry of contentDiff(live, draft)) {
    const [item, root = "", key = ""] = ITEM.exec(entry.path) ?? [];
    const whole = item && !(holds(live, root, key) && holds(draft, root, key)) ? item : null;
    // A keyed list empty on one side is one leaf (`projects`, "[]"): it goes with the list's order.
    const order = KEYED.test(entry.path) ? `${entry.path} (order)` : null;
    const path = whole ?? order ?? fieldOf(entry.path);
    const row = rows.get(path) ?? { path, kind: entry.kind, entries: [] };
    if (row.kind !== entry.kind) {
      row.kind = "changed";
    }
    row.entries.push(entry);
    rows.set(path, row);
  }
  return [
    ...rows.values(),
    ...docs.map((doc) => ({ path: doc.key, kind: doc.change, entries: [], doc })),
  ];
}

/**
 * The rows counted as a person reads them. A list's new order is listed but not counted beside the
 * items that moved into it; a reorder on its own is still one change: visitors see it.
 */
export function countRows(rows: readonly ChangeRow[], changed: boolean): number {
  const counted = rows.filter((row) => !row.path.endsWith("(order)")).length;
  return changed ? Math.max(1, counted) : counted;
}

/**
 * What is live against the draft, field by field. Before the first publish
 * nothing is live: every field is new, and the empty document it is compared
 * with is not itself a change (it would read as a removed root, path "").
 */
export function contentDiff(live: unknown, draft: unknown): DiffEntry[] {
  return diffJson(live ?? {}, draft).filter((entry) => entry.path !== "");
}

export function summarizeLocale(review: LocaleReview): LocaleSummary {
  const changes =
    review.changed && review.draft
      ? countRows(changeRows(review.live, review.draft, review.docs), true)
      : 0;
  return { locale: review.locale, changes, issues: review.issues.length };
}

export function summarizeReview(review: PublishReview): PublishSummary {
  const locales = review.locales.map((locale) => summarizeLocale(locale));
  return {
    locales,
    total: locales.reduce((sum, l) => sum + l.changes, 0),
    issues: locales.reduce((sum, l) => sum + l.issues, 0),
    canPublish: review.canPublish,
  };
}

/** "3 changes", "1 change". */
export function changesLabel(n: number): string {
  return `${n} ${n === 1 ? "change" : "changes"}`;
}
