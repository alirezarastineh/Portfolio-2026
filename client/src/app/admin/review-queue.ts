import {
  REVIEW_LABELS,
  type ReviewEntry,
  type ReviewLabel,
  type ReviewLabels,
} from "./assistant-types";

/**
 * How the Reviews tab works a week's queue: labels that cycle good → not →
 * does not apply, the next answer still to review, and each label's share of
 * good verdicts. Pure, so the component stays thin.
 */

export const LABEL_NAMES: Record<ReviewLabel, string> = {
  correct: "Correct",
  grounded: "Grounded in the cited documents",
  helpful: "Helpful",
  tone: "Tone",
  language: "Language",
};

export function emptyLabels(): ReviewLabels {
  return Object.fromEntries(REVIEW_LABELS.map((l) => [l, null])) as ReviewLabels;
}

/** Not set → good → not good → not set. */
export function cycleLabel(value: boolean | null): boolean | null {
  if (value === null) return true;
  return value ? false : null;
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
