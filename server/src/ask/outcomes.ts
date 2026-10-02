import { QUESTION_FLAGS } from "./checks.js";
import { FAITHFUL_AT } from "./evals/calibration.js";
import { isoWeek, weekBounds } from "./reviews.js";

/**
 * The assistant's outcomes, the evaluation stack's fifth layer: whether
 * visitors got what they came for, read from what they did next. No single
 * number is trusted (Goodhart's law): the helpful share is a composite of
 * several signals, and the primary metric rotates once it stops moving.
 * Pure: the admin route loads the rows.
 */

/** One terminal answer, with what followed it. */
export interface OutcomeRow {
  id: string;
  sessionHash: string;
  createdAt: Date;
  question: string;
  finishReason: string;
  usd: number;
  /** The deterministic checks' flags. */
  flags: readonly string[];
  feedback: 1 | -1 | null;
  /** The judge's faithfulness, when the answer was judged. */
  faithfulness: number | null;
  /** The answer said the portfolio does not have it. */
  unknown: boolean;
  handoffOffered: boolean;
  handoffConfirmed: boolean;
}

/** A near-duplicate question this soon after an answer means the answer did not land. */
export const REPHRASE_WINDOW_MS = 2 * 60 * 1000;
export const REPHRASE_SIMILARITY = 0.5;
/** A primary metric that moved less than this in each of two weekly reviews is flat. */
export const FLAT_WITHIN = 0.01;

const STOPWORDS = new Set(
  "a an and are be can de der die das did do does for his he in is it of on or the to und was what where which who with you".split(
    " ",
  ),
);

/** A question's content words: lowercased, no punctuation, no stopwords or single letters. */
export function questionWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

/** Jaccard similarity of two questions' content words. */
export function similarity(a: string, b: string): number {
  const x = questionWords(a);
  const y = questionWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return shared / (x.size + y.size - shared);
}

/** Answers followed, in the same session within two minutes, by a near-duplicate question. */
export function rephrased(rows: readonly OutcomeRow[]): Set<string> {
  const bySession = new Map<string, OutcomeRow[]>();
  for (const row of rows) {
    const session = bySession.get(row.sessionHash) ?? [];
    session.push(row);
    bySession.set(row.sessionHash, session);
  }
  const ids = new Set<string>();
  for (const session of bySession.values()) {
    session.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 1; i < session.length; i++) {
      const [before, after] = [session[i - 1]!, session[i]!];
      const soon = after.createdAt.getTime() - before.createdAt.getTime() <= REPHRASE_WINDOW_MS;
      if (soon && similarity(before.question, after.question) >= REPHRASE_SIMILARITY) {
        ids.add(before.id);
      }
    }
  }
  return ids;
}

/** The visitor got an answer: not an error, not cut off. */
export function isAnswered(row: OutcomeRow): boolean {
  return !row.finishReason.startsWith("error") && row.finishReason !== "aborted";
}

/**
 * No flag on the answer, not rephrased, no thumbs-down, and faithful when
 * judged. A flag on the question (an injection attempt) says nothing about it.
 */
export function isHelpful(row: OutcomeRow, rephrasedIds: ReadonlySet<string>): boolean {
  return (
    isAnswered(row) &&
    !row.flags.some((flag) => !(QUESTION_FLAGS as readonly string[]).includes(flag)) &&
    !rephrasedIds.has(row.id) &&
    row.feedback !== -1 &&
    (row.faithfulness === null || row.faithfulness >= FAITHFUL_AT)
  );
}

export interface Outcomes {
  answers: number;
  answered: number;
  helpful: number;
  /** Hand-off offered (the tool) → confirmed (the visitor's yes) → sent (the form). */
  funnel: { offered: number; confirmed: number; sent: number };
  rated: { up: number; down: number };
  /** Shares; null when there is nothing to divide by. */
  helpfulRate: number | null;
  thumbsUpRate: number | null;
  unknownRate: number | null;
  rephraseRate: number | null;
  usd: number;
  costPerAnswered: number | null;
  costPerHelpful: number | null;
}

const share = (part: number, whole: number) => (whole ? part / whole : null);

export function outcomes(rows: readonly OutcomeRow[], sent: number): Outcomes {
  const again = rephrased(rows);
  const answered = rows.filter(isAnswered);
  const helpful = answered.filter((row) => isHelpful(row, again)).length;
  const up = rows.filter((row) => row.feedback === 1).length;
  const down = rows.filter((row) => row.feedback === -1).length;
  const usd = rows.reduce((sum, row) => sum + row.usd, 0);
  return {
    answers: rows.length,
    answered: answered.length,
    helpful,
    funnel: {
      offered: rows.filter((row) => row.handoffOffered).length,
      confirmed: rows.filter((row) => row.handoffConfirmed).length,
      sent,
    },
    rated: { up, down },
    helpfulRate: share(helpful, answered.length),
    thumbsUpRate: share(up, up + down),
    unknownRate: share(answered.filter((row) => row.unknown).length, answered.length),
    rephraseRate: share(answered.filter((row) => again.has(row.id)).length, answered.length),
    usd,
    costPerAnswered: answered.length ? usd / answered.length : null,
    costPerHelpful: helpful ? usd / helpful : null,
  };
}

export const PRIMARY_METRICS = [
  "helpfulRate",
  "thumbsUpRate",
  "unknownRate",
  "rephraseRate",
] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

/** The `count` complete ISO weeks before the current one, oldest first: the weekly reviews. */
export function completedWeeks(count: number, now = new Date()): string[] {
  const weeks: string[] = [];
  let start = weekBounds(isoWeek(now))!.start;
  for (let i = 0; i < count; i++) {
    const week = isoWeek(new Date(start.getTime() - 1));
    weeks.unshift(week);
    start = weekBounds(week)!.start;
  }
  return weeks;
}

/** The metric per ISO week, oldest first; a week without data is null. */
export function weeklyValues(
  rows: readonly OutcomeRow[],
  metric: PrimaryMetric,
  weeks: readonly string[],
): { week: string; value: number | null }[] {
  return weeks.map((week) => {
    const inWeek = rows.filter((row) => isoWeek(row.createdAt) === week);
    return { week, value: outcomes(inWeek, 0)[metric] };
  });
}

/**
 * The rotation rule: when the primary metric moved less than a point in each
 * of the last two weekly reviews, promote another one, even if it still looks
 * fine. A missing week says nothing, so it never triggers the rule.
 */
export function shouldRotate(values: readonly (number | null)[]): boolean {
  const last = values.slice(-3);
  if (last.length < 3 || last.includes(null)) return false;
  const [a, b, c] = last as [number, number, number];
  return Math.abs(c - b) < FLAT_WITHIN && Math.abs(b - a) < FLAT_WITHIN;
}
