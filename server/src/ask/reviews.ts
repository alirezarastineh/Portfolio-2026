import { createHash } from "node:crypto";

/**
 * The weekly human review (the evaluation stack's fourth layer): a random 5 %
 * of the week's visitor answers, at least 10 and at most 30, plus every
 * answer something already flagged (a check, a thumbs-down, an "it isn't
 * there"). Teams fail by reviewing nothing or everything; this is enough to
 * catch drift and to calibrate the judge (plan phase 10) against people.
 *
 * The sample is a pure function of the week and the answers in it: the same
 * week always yields the same queue. While a week is still filling up the
 * sample can move; an answer already reviewed stays in the queue.
 */

export const REVIEW_LABELS = ["correct", "grounded", "helpful", "tone", "language"] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];
/** true = good, false = not, null = does not apply. */
export type ReviewLabels = Record<ReviewLabel, boolean | null>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-W40": the ISO week (Monday to Sunday, UTC) a moment falls in. */
export function isoWeek(at: Date): string {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  // The week belongs to the year its Thursday is in.
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The week's first moment (Monday 00:00 UTC) and the next week's; null for a malformed week. */
export function weekBounds(week: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  const start = new Date(firstMonday + (number - 1) * 7 * DAY_MS);
  // Week 53 exists only in some years.
  if (isoWeek(start) !== week) return null;
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

/** 5 % of the week's answers, at least 10 and at most 30, never more than there are. */
export function sampleSize(total: number): number {
  return Math.min(total, Math.max(10, Math.min(30, Math.ceil(total * 0.05))));
}

export interface ReviewCandidate {
  id: string;
  /** Why it must be reviewed whatever the sample: check flags, a thumbs-down, "didn't know". */
  reasons: string[];
  /** Reviewed already: it stays in the queue when the sample moves on. */
  reviewed?: boolean;
}

/** The reasons an answer is reviewed whatever the sample, people's signals first. */
export function reviewReasons(signals: {
  thumbsDown: boolean;
  unknown: boolean;
  flags: readonly string[];
}): string[] {
  return [
    ...(signals.thumbsDown ? ["thumbs down"] : []),
    ...(signals.unknown ? ["didn't know"] : []),
    ...signals.flags.map((flag) => `check:${flag}`),
  ];
}

export interface QueueEntry {
  id: string;
  reasons: string[];
  sampled: boolean;
}

function rank(week: string, id: string): string {
  return createHash("sha256").update(`${week}:${id}`).digest("hex");
}

/** The week's queue: everything flagged, then the random sample, each once. */
export function buildQueue(week: string, candidates: readonly ReviewCandidate[]): QueueEntry[] {
  const ordered = [...candidates].sort((a, b) => rank(week, a.id).localeCompare(rank(week, b.id)));
  const sampled = new Set(ordered.slice(0, sampleSize(candidates.length)).map((c) => c.id));
  const flagged = ordered.filter((c) => c.reasons.length);
  const rest = ordered.filter((c) => !c.reasons.length && (sampled.has(c.id) || c.reviewed));
  return [...flagged, ...rest].map((c) => ({
    id: c.id,
    reasons: c.reasons,
    sampled: sampled.has(c.id),
  }));
}

/** Per label: how many reviews said good and how many said not. */
export function labelStats(
  reviews: readonly { labels: Partial<ReviewLabels> }[],
): Record<ReviewLabel, { good: number; bad: number }> {
  const stats = Object.fromEntries(REVIEW_LABELS.map((l) => [l, { good: 0, bad: 0 }])) as Record<
    ReviewLabel,
    { good: number; bad: number }
  >;
  for (const review of reviews) {
    for (const label of REVIEW_LABELS) {
      const value = review.labels[label];
      if (value === true) stats[label].good++;
      else if (value === false) stats[label].bad++;
    }
  }
  return stats;
}
