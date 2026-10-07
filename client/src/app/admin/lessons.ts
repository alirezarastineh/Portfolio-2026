import type { InsightsNotice, InsightTopic } from "./assistant-types";
import { HEURISTIC_MIN_WORDS, type JournalEntry } from "./journal";

/**
 * Lessons in the admin (plan phase 25; `server/src/ask/lessons.ts`): the
 * failure journal's top tier. A lesson is written by the admin, corroborated
 * by three decided journal entries or an unanswered insight topic of five
 * questions, applied as a fix, and measured on visitors' answers before and
 * since; the nightly check retires one that does not work. Shapes and pure
 * helpers for the Journal and Insights tabs.
 */

export type LessonStatus = "proposed" | "active" | "retired";
export type AppliedAs = "faq" | "content-task" | "prompt-rule" | "eval-case";

export interface Rates {
  answers: number;
  unknown: number;
  down: number;
  failed: number;
}

export interface LessonEffect {
  at: string;
  /** Where "since" starts: the fix, or the admin's reopening after a retirement. */
  since: string;
  before: Rates;
  after: Rates;
  applications: number;
  successes: number;
  /** successes / applications; null with none: correlation, not cause. */
  value: number | null;
}

export interface Lesson {
  id: string;
  createdAt: string;
  updatedAt: string;
  statement: string;
  scope: string[];
  source: "journal" | "insight";
  journalIds: string[];
  topic: { snapshotId: string; title: string; questions: number; unanswered: boolean } | null;
  appliedAs: AppliedAs | null;
  appliedRef: string | null;
  appliedAt: string | null;
  /** When the admin last reopened it: measured again from then. */
  reopenedAt: string | null;
  status: LessonStatus;
  /** What the nightly check stored last. */
  effectiveness: LessonEffect | null;
  retiredReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Computed for this view from the answers kept; null before it is applied. */
  effect: LessonEffect | null;
}

export interface LessonsView {
  lessons: Lesson[];
  counts: Record<LessonStatus, number>;
}

/** Where a lesson comes from: three decided journal entries, or an unanswered insight topic. */
export type LessonSource =
  | { source: "journal"; journalIds: string[] }
  | { source: "insight"; snapshotId: string; topic: number };

/** A new lesson: the admin's words and scope, and where it comes from. */
export type LessonInput = LessonSource & { statement: string; scope: string[] };

/** One change at a time: the words, or one decision. */
export interface LessonPatch {
  statement?: string;
  scope?: string[];
  apply?: { as: AppliedAs; ref: string };
  retire?: true;
  reopen?: true;
}

/** An insights run as kept (`server/src/ask/insights.ts`). */
export interface InsightSnapshot {
  id: string;
  createdAt: string;
  /** The admin's, or the adaptive trigger's. */
  trigger: "admin" | "auto";
  analysed: number;
  topics: InsightTopic[];
  /** The trigger's numbers; empty for the admin's. */
  reason: string;
  usd: number;
  seenAt: string | null;
}

export interface InsightsView {
  snapshot: InsightSnapshot | null;
  /** The nightly check's last word on the trigger. */
  trigger: { at: string; decision: string; reason: string } | null;
}

/** The server's rules (lessons.ts `LESSON_RULES`), for what the forms say. */
export const LESSON_RULES = {
  minEntries: 3,
  maxEntries: 20,
  minTopicQuestions: 5,
  floor: 0.5,
  minApplications: 5,
  maxScope: 12,
} as const;

export const APPLIED_AS: { id: AppliedAs; label: string; ref: string }[] = [
  { id: "faq", label: "FAQ entry", ref: "The FAQ entry's id" },
  { id: "content-task", label: "Content change", ref: "The document or page changed" },
  {
    id: "prompt-rule",
    label: "Prompt rule (through the eval gate)",
    ref: "The prompt version it shipped in",
  },
  { id: "eval-case", label: "Eval case", ref: "The eval case's id" },
];

export const appliedLabel = (id: AppliedAs): string =>
  APPLIED_AS.find((a) => a.id === id)?.label ?? id;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "5 answers: 1 said it isn't there, 0 thumbs down, 1 failed". */
export function ratesLine(r: Rates): string {
  if (!r.answers) return "no matching answers";
  return `${plural(r.answers, "answer", "answers")}: ${r.unknown} said it isn't there, ${r.down} thumbs down, ${r.failed} failed`;
}

/** The effect in one line: a count until there are enough applications to judge. */
export function effectLine(effect: LessonEffect | null): string {
  if (!effect) return "Not applied yet: nothing to measure.";
  const { applications, successes, value } = effect;
  if (value === null || applications < LESSON_RULES.minApplications) {
    return `Too little to judge yet: ${successes} of ${plural(applications, "matching answer", "matching answers")} since the fix went well (${LESSON_RULES.minApplications} needed).`;
  }
  return `Effectiveness ${value.toFixed(2)}: ${successes} of ${applications} matching answers since the fix went well.`;
}

/** Why these journal entries cannot become a lesson yet; null when they can. */
export function promoteProblem(entries: readonly Pick<JournalEntry, "status">[]): string | null {
  const decided = entries.filter((e) => e.status === "accepted" || e.status === "fixed").length;
  if (decided > LESSON_RULES.maxEntries) {
    return `A lesson names at most ${LESSON_RULES.maxEntries} entries (${decided} selected).`;
  }
  return decided >= LESSON_RULES.minEntries
    ? null
    : `Select ${LESSON_RULES.minEntries} accepted or fixed entries (${decided} selected).`;
}

/** Scope words as the server keeps them: 3–40 letters or digits, lowercase, distinct, at most 12. */
export function scopeWords(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const word = raw.trim().toLowerCase();
    if (!/^[\p{L}\p{N}]{3,40}$/u.test(word) || words.includes(word)) continue;
    words.push(word);
    if (words.length === LESSON_RULES.maxScope) break;
  }
  return words;
}

/** A first scope for a lesson from journal entries: the corpus words where they found the fact. */
export function scopeFromEntries(entries: readonly Pick<JournalEntry, "diagnosis">[]): string[] {
  return scopeWords(entries.flatMap((e) => e.diagnosis.located?.words ?? []).join(" "));
}

/** Why an insight topic cannot become a lesson; null when it can. */
export function topicProblem(topic: Pick<InsightTopic, "questions" | "unanswered">): string | null {
  if (!topic.unanswered) return "Only a topic the assistant could not answer becomes a lesson.";
  return topic.questions >= LESSON_RULES.minTopicQuestions
    ? null
    : `A lesson needs ${LESSON_RULES.minTopicQuestions} questions on the topic; it has ${topic.questions}.`;
}

/** Joining words in a topic's title, which no question is matched by. */
const TITLE_FILLERS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "about",
  "und",
  "der",
  "die",
  "das",
  "mit",
  "von",
  "für",
]);

/** A first scope for a lesson from an insight topic: its title's words. */
export function scopeFromTitle(title: string): string[] {
  return scopeWords(title).filter((word) => !TITLE_FILLERS.has(word));
}

const REFUSALS: Record<string, string> = {
  vague_statement: `Write the lesson as a rule someone can follow: at least ${HEURISTIC_MIN_WORDS} words.`,
  empty_scope: "Name at least one word of 3 letters or more that its questions contain.",
  unknown_entry: "An entry was deleted meanwhile: reload the journal.",
  unknown_topic: "That insights run is gone (runs are kept under 60 days): run insights again.",
  bad_transition: "The lesson changed meanwhile: reload the journal.",
  not_found: "The lesson was deleted meanwhile.",
  invalid_input:
    "Something in the lesson is out of bounds: at most 500 characters, 40 scope words and 20 entries.",
};

/** A refusal in words; `not_corroborated` carries the server's reason. */
export function lessonRefusal(error: string, detail?: unknown): string {
  if (error === "not_corroborated") {
    const reason = (detail as { reason?: unknown } | undefined)?.reason;
    return typeof reason === "string" ? `Not corroborated: ${reason}.` : "Not corroborated yet.";
  }
  return REFUSALS[error] ?? error;
}

/** Why the form cannot send this lesson yet; null when it can. */
export function lessonProblem(statement: string, scopeText: string): string | null {
  const words = statement.trim().split(/\s+/).filter(Boolean).length;
  if (words < HEURISTIC_MIN_WORDS) {
    return `Write the lesson as a rule someone can follow: at least ${HEURISTIC_MIN_WORDS} words (${words} so far).`;
  }
  return scopeWords(scopeText).length ? null : REFUSALS["empty_scope"]!;
}

/** The Overview's notice: why insights ran by themselves, and what they found. */
export function noticeLine(notice: Pick<InsightsNotice, "reason" | "unanswered">): string {
  const topics = notice.unanswered === 1 ? "1 topic" : `${notice.unanswered} topics`;
  return `Insights ran by themselves (${notice.reason}): ${topics} the assistant could not answer.`;
}
