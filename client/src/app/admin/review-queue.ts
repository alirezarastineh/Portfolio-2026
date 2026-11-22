import {
  REVIEW_LABELS,
  type ReviewEntry,
  type ReviewLabel,
  type ReviewLabels,
} from "./assistant-types";

/**
 * How the Reviews view works a week's queue: a draft per answer, kept until it is saved, the
 * next answer still to review, each label's share of good verdicts and the week in words. Pure,
 * so the component stays thin.
 */

export const LABEL_NAMES: Record<ReviewLabel, string> = {
  correct: "Correct",
  grounded: "Grounded in the cited documents",
  helpful: "Helpful",
  tone: "Tone",
  language: "Language",
};

/** What the reviewer picked and typed for one answer. A verdict not picked yet is missing. */
export interface ReviewDraft {
  labels: Partial<ReviewLabels>;
  note: string;
}

/** The answer's saved review as a draft; a fresh answer has nothing picked. */
export function savedDraft(entry: ReviewEntry): ReviewDraft {
  return entry.review
    ? { labels: { ...entry.review.labels }, note: entry.review.note ?? "" }
    : { labels: {}, note: "" };
}

/** True when two drafts pick the same verdicts and say the same note. */
export function sameDraft(a: ReviewDraft, b: ReviewDraft): boolean {
  return a.note === b.note && REVIEW_LABELS.every((label) => a.labels[label] === b.labels[label]);
}

/** Nothing picked and no note: a save would count the answer reviewed and say nothing. */
export function isEmptyReview(draft: ReviewDraft): boolean {
  return REVIEW_LABELS.every((label) => draft.labels[label] === undefined) && !draft.note.trim();
}

/** The verdicts as the server takes them: one left open is saved as "Does not apply" (null). */
export function toLabels(draft: ReviewDraft): ReviewLabels {
  const {
    correct = null,
    grounded = null,
    helpful = null,
    tone = null,
    language = null,
  } = draft.labels;
  return { correct, grounded, helpful, tone, language };
}

/** The first answer after `fromId` (or from the start) with no review yet. */
export function nextUnreviewed(
  queue: readonly ReviewEntry[],
  fromId: string | null,
): ReviewEntry | null {
  const start = fromId ? queue.findIndex((e) => e.message.id === fromId) + 1 : 0;
  return (
    queue.slice(start).find((e) => !e.review) ??
    queue.slice(0, start).find((e) => !e.review) ??
    null
  );
}

/** Good verdicts as a share of the verdicts given, or null when there are none. */
export function goodShare(stat: { good: number; bad: number }): number | null {
  const given = stat.good + stat.bad;
  return given ? stat.good / given : null;
}

/** "Correct 92 %, Grounded in the cited documents 88 %, Helpful none yet, …" */
export function sharesLine(stats: Record<ReviewLabel, { good: number; bad: number }>): string {
  return REVIEW_LABELS.map((label) => {
    const share = goodShare(stats[label]);
    return `${LABEL_NAMES[label]} ${share === null ? "none yet" : percent(share)}`;
  }).join(", ");
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

const DAY_MS = 86_400_000;
const DAYS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** An ISO week as the server names it ("2026-W45"), or null. */
function isoWeek(week: string): { year: number; number: number } | null {
  const groups = /^(?<year>\d{4})-W(?<week>\d{2})$/.exec(week)?.groups;
  return groups ? { year: Number(groups["year"]), number: Number(groups["week"]) } : null;
}

/** "Week 45 of 2026 (2–8 November)"; a week it cannot read, as it came. */
export function weekWords(week: string): string {
  const iso = isoWeek(week);
  if (!iso) {
    return week;
  }
  // ISO 8601: week 1 holds 4 January, and every week starts on a Monday.
  const january4 = Date.UTC(iso.year, 0, 4);
  const monday = january4 - ((new Date(january4).getUTCDay() + 6) % 7) * DAY_MS;
  const start = monday + (iso.number - 1) * 7 * DAY_MS;
  const days = DAYS.formatRange(new Date(start), new Date(start + 6 * DAY_MS));
  return `Week ${iso.number} of ${iso.year} (${days})`;
}

/** "week 45", for a sentence; "this week" for a week it cannot read. */
export function weekOf(week: string): string {
  const iso = isoWeek(week);
  return iso ? `week ${iso.number}` : "this week";
}
