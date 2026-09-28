import type { Locale } from "../content/schema";
import type { LocaleReview, PublishReview } from "./admin-api.service";
import { diffJson, type DiffEntry } from "./json-diff";

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
 * The changes the review lists, counted as a person reads them. A list's new
 * order is shown but not counted beside the items that moved into it, so
 * adding a project is its fields, not its fields plus "order". A reorder on its
 * own is still one change: visitors see it.
 */
export function countChanges(core: readonly DiffEntry[], docs: number, changed: boolean): number {
  const counted = core.filter((entry) => !entry.path.endsWith("(order)")).length + docs;
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
      ? countChanges(contentDiff(review.live, review.draft), review.docs.length, true)
      : 0;
  return { locale: review.locale, changes, issues: review.issues.length };
}

export function summarizeReview(review: PublishReview): PublishSummary {
  const locales = review.locales.map(summarizeLocale);
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
