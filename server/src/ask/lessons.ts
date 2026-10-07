import { contentWords, sameWord } from "./journal.js";
import { isHelpful, rephrased, type OutcomeRow } from "./outcomes.js";

/**
 * Lessons (plan phase 25), the failure journal's top tier: the book's
 * Experience Replay keeps raw traces (L0, the answers), per-failure
 * explanations (L1, journal entries) and corroborated cross-task lessons
 * (L2, here). A lesson is admin-written and corroborated first (three
 * decided journal entries, or an unanswered insight topic of five
 * questions); it is applied as a fix (an FAQ entry, a content task, a prompt
 * rule through the eval gate, an eval case), never by entering the prompt;
 * and it is measured on what visitors' answers did after the fix, and
 * retired when it does not work ("false lessons are worse than none"). The
 * adaptive trigger runs insights when failures rise, not on a timer. Pure:
 * the routes and the nightly check load the rows. The thresholds are the
 * book's starting points.
 */

export const TRIGGER_RULES = {
  /** Visitor answers kept, at least. */
  minAnswers: 60,
  /** Answers newer than the latest insights' newest, at least. */
  minNew: 10,
  /** The last this many answers, compared with as many before them. */
  window: 30,
  /** The last window's failure rate must exceed the one before times this… */
  ratio: 1.5,
  /** …with at least `minFailures` failures among the last `recent` answers. */
  recent: 20,
  minFailures: 2,
} as const;

export const LESSON_RULES = {
  /** A lesson from the journal: at least this many entries, each accepted or fixed… */
  minEntries: 3,
  /** …and at most this many. */
  maxEntries: 20,
  /** A lesson from insights: an unanswered topic of at least this many questions. */
  minTopicQuestions: 5,
  /** The effect compares this many days before the fix with the time since. */
  beforeDays: 30,
  /** A lesson is retired below this effectiveness… */
  floor: 0.5,
  /** …after at least this many applications. */
  minApplications: 5,
  /** Its scope: at most this many words. */
  maxScope: 12,
} as const;

/** Not what the visitor came for: not helpful (outcomes.ts), or "it isn't there". */
export function failed(row: OutcomeRow, again: ReadonlySet<string>): boolean {
  return !isHelpful(row, again) || row.unknown;
}

export interface TriggerVerdict {
  fire: boolean;
  /** The numbers in words: what the audit row and the notice say. */
  reason: string;
  answers: number;
  newSince: number;
  recent: { answers: number; failed: number };
  previous: { answers: number; failed: number };
  /** Failures among the last `TRIGGER_RULES.recent` answers. */
  lastFailed: number;
}

const rate = (side: { answers: number; failed: number }) =>
  side.answers ? side.failed / side.answers : 0;

/**
 * The adaptive trigger, over whether each answer kept failed (newest first)
 * and how many answers are newer than the latest insights.
 */
export function triggerVerdict(failures: readonly boolean[], newSince: number): TriggerVerdict {
  const r = TRIGGER_RULES;
  const side = (xs: readonly boolean[]) => ({
    answers: xs.length,
    failed: xs.filter(Boolean).length,
  });
  const recent = side(failures.slice(0, r.window));
  const previous = side(failures.slice(r.window, 2 * r.window));
  const lastFailed = side(failures.slice(0, r.recent)).failed;
  const verdict = { answers: failures.length, newSince, recent, previous, lastFailed };
  const numbers = `the last ${r.window}: ${recent.failed} failed; the ${r.window} before: ${previous.failed} failed; ${newSince} new since the last insights`;
  const no = (reason: string): TriggerVerdict => ({ ...verdict, fire: false, reason });

  if (failures.length < r.minAnswers) {
    return no(`${failures.length} answers kept; ${r.minAnswers} needed`);
  }
  if (newSince < r.minNew) {
    return no(`${newSince} new answers since the last insights; ${r.minNew} needed`);
  }
  if (rate(recent) <= r.ratio * rate(previous)) return no(`failures did not rise: ${numbers}`);
  if (lastFailed < r.minFailures) {
    return no(`${lastFailed} failed among the last ${r.recent}; ${r.minFailures} needed`);
  }
  return { ...verdict, fire: true, reason: `failures rose: ${numbers}` };
}

/** A lesson's scope: distinct lowercase words of 3 to 40 letters or digits, at most 12. */
export function cleanScope(words: readonly string[]): string[] {
  const scope: string[] = [];
  for (const raw of words) {
    const word = raw.trim().toLowerCase();
    if (!/^[\p{L}\p{N}]{3,40}$/u.test(word) || scope.includes(word)) continue;
    scope.push(word);
    if (scope.length === LESSON_RULES.maxScope) break;
  }
  return scope;
}

/** Whether a question is one the lesson is about: a content word of the same stem as its scope. */
export function inScope(question: string, scope: readonly string[]): boolean {
  if (!scope.length) return false;
  return contentWords(question).some((word) => scope.some((s) => sameWord(word, s)));
}

export interface Rates {
  answers: number;
  unknown: number;
  down: number;
  failed: number;
}

/** What a lesson's fix did: the matching answers before it and since. */
export interface LessonEffect {
  /** When it was measured. */
  at: string;
  /** Where "since" starts: the fix, or the admin's reopening after a retirement. */
  since: string;
  before: Rates;
  after: Rates;
  /** The matching answers since the fix. */
  applications: number;
  /** Of those, the ones that did not fail. */
  successes: number;
  /** successes / applications; null with none (correlation, not cause). */
  value: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const noRates = (): Rates => ({ answers: 0, unknown: 0, down: 0, failed: 0 });

/**
 * The matching answers in the 30 days before the fix, and since: since the
 * fix, or since the admin reopened the lesson (`reopenedAt`), so a reopened
 * lesson is judged on new answers only, as the trust monitor counts evidence
 * since a reinstatement. Answers between the fix and a reopening count in
 * neither.
 */
export function lessonEffect(
  rows: readonly OutcomeRow[],
  scope: readonly string[],
  appliedAt: Date,
  now: Date,
  reopenedAt: Date | null = null,
): LessonEffect {
  const again = rephrased(rows);
  const applied = appliedAt.getTime();
  const from = applied - LESSON_RULES.beforeDays * DAY_MS;
  const since = Math.max(applied, reopenedAt?.getTime() ?? 0);
  const before = noRates();
  const after = noRates();
  for (const row of rows) {
    const t = row.createdAt.getTime();
    if (t < from || (t >= applied && t < since) || !inScope(row.question, scope)) continue;
    const rates = t >= applied ? after : before;
    rates.answers++;
    if (row.unknown) rates.unknown++;
    if (row.feedback === -1) rates.down++;
    if (failed(row, again)) rates.failed++;
  }
  const successes = after.answers - after.failed;
  return {
    at: now.toISOString(),
    since: new Date(since).toISOString(),
    before,
    after,
    applications: after.answers,
    successes,
    value: after.answers ? successes / after.answers : null,
  };
}

/** Why a lesson is retired: below the floor after enough applications; null otherwise. */
export function evictionReason(
  effect: Pick<LessonEffect, "applications" | "value">,
): string | null {
  const { floor, minApplications } = LESSON_RULES;
  if (effect.value === null || effect.applications < minApplications || effect.value >= floor) {
    return null;
  }
  return `effectiveness ${effect.value.toFixed(2)} after ${effect.applications} applications (floor ${floor})`;
}

export type LessonSource =
  | { source: "journal"; entries: readonly { status: string }[] }
  | { source: "insight"; topic: { questions: number; unanswered: boolean } };

/** Why a lesson is not corroborated yet; null when it is. */
export function corroborationProblem(input: LessonSource): string | null {
  if (input.source === "journal") {
    const decided = input.entries.filter((e) => e.status === "accepted" || e.status === "fixed");
    const undecided = input.entries.length - decided.length;
    // Every entry a lesson names is one the admin stood behind.
    if (undecided) {
      return `every journal entry of a lesson must be accepted or fixed; ${undecided} ${undecided === 1 ? "is" : "are"} not`;
    }
    return decided.length >= LESSON_RULES.minEntries
      ? null
      : `a lesson needs ${LESSON_RULES.minEntries} accepted or fixed journal entries; ${decided.length} given`;
  }
  const { topic } = input;
  if (!topic.unanswered) return "the topic is not one the assistant could not answer";
  return topic.questions >= LESSON_RULES.minTopicQuestions
    ? null
    : `the topic has ${topic.questions} questions; ${LESSON_RULES.minTopicQuestions} needed`;
}
