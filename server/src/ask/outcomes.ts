import { QUESTION_FLAGS } from "./checks.js";
import { FAITHFUL_AT } from "./evals/calibration.js";
import { MATCH_KINDS, type MatchKind } from "./match/prompt.js";
import type { AnswerTrace } from "./trace.js";
import { isoWeek, weekBounds } from "./reviews.js";
import { FEEDBACK_REASONS, type AnswerSignals, type FeedbackReason } from "./signals.js";

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
  /** Why the 👎, when one came with a reason (visitor plan V2). */
  downReason?: string | null;
  /** What the visitor's browser saw of the answer (V2); null until it reports. */
  signals?: AnswerSignals | null;
  /** The server's time to the first token, for the browser's figure beside it. */
  ttftMs?: number | null;
  /** The answer offered follow-up questions. */
  followupsOffered?: boolean;
  /** The answer cited at least one document. */
  cited?: boolean;
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

/** The `p`-th percentile (0–1) by nearest rank; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

/**
 * What the visitors' browsers saw (the visitor plan's V2): the time to the
 * first visible word as a visitor waits for it, network and all, beside the
 * server's own first token; how often an answer was stopped, its follow-ups or
 * citations followed, it was copied or asked again; and why the 👎s. Each
 * share counts only the answers it can apply to (a follow-up click needs
 * follow-ups offered). A stop stays out of `helpful`: it can mean "enough" as
 * well as "wrong", and the rotation rule can promote a signal once the data
 * says which.
 */
export interface BrowserView {
  /** Answers whose browser reported anything. */
  reported: number;
  shownP50Ms: number | null;
  shownP95Ms: number | null;
  /** The server's first token for the same answers: the gap is the network and the page. */
  serverP50Ms: number | null;
  serverP95Ms: number | null;
  /** Shares of the reported answers. */
  stopRate: number | null;
  copyRate: number | null;
  /** Of the reported answers that offered follow-ups. */
  followupRate: number | null;
  /** Of the reported answers that cited a document. */
  citationRate: number | null;
  /** Answers asked again after they failed. */
  retried: number;
  /** The 👎s by reason; `none` when the visitor gave none. */
  downReasons: Record<FeedbackReason | "none", number>;
}

export function browserView(rows: readonly OutcomeRow[]): BrowserView {
  const reported = rows.filter((row) => row.signals);
  const counted = (pick: (signals: AnswerSignals) => boolean, of: readonly OutcomeRow[]) =>
    share(of.filter((row) => pick(row.signals!)).length, of.length);
  const shown = reported
    .map((row) => row.signals!.shownMs)
    .filter((ms): ms is number => typeof ms === "number");
  const server = reported
    .map((row) => row.ttftMs)
    .filter((ms): ms is number => typeof ms === "number");
  const downReasons = Object.fromEntries(
    [...FEEDBACK_REASONS, "none"].map((reason) => [reason, 0]),
  ) as BrowserView["downReasons"];
  for (const row of rows) {
    if (row.feedback !== -1) continue;
    const reason = (FEEDBACK_REASONS as readonly string[]).includes(row.downReason ?? "")
      ? (row.downReason as FeedbackReason)
      : "none";
    downReasons[reason]++;
  }
  return {
    reported: reported.length,
    shownP50Ms: percentile(shown, 0.5),
    shownP95Ms: percentile(shown, 0.95),
    serverP50Ms: percentile(server, 0.5),
    serverP95Ms: percentile(server, 0.95),
    stopRate: counted((s) => s.stopped === true, reported),
    copyRate: counted((s) => (s.copies ?? 0) > 0, reported),
    followupRate: counted(
      (s) => (s.followups ?? 0) > 0,
      reported.filter((row) => row.followupsOffered),
    ),
    citationRate: counted(
      (s) => (s.citations ?? 0) > 0,
      reported.filter((row) => row.cited),
    ),
    retried: reported.filter((row) => (row.signals!.retries ?? 0) > 0).length,
    downReasons,
  };
}

/**
 * The guided tours planned for an interest (visitor plan V16) and the share
 * the visitor took to the last stop, as their browsers reported it. Tours are
 * no answers: none of the measures above counts them.
 */
export interface TourCounts {
  started: number;
  finished: number;
  finishedRate: number | null;
}

export function tourCounts(rows: readonly { signals: AnswerSignals | null }[]): TourCounts {
  const finished = rows.filter((row) => row.signals?.tourDone === true).length;
  return { started: rows.length, finished, finishedRate: share(finished, rows.length) };
}

/**
 * Matched briefs (visitor plan V20), no answers either: the runs of each kind
 * and how many the visitor took to the hand-off; the rows shown and those the
 * critic made "not published" (the trust check's measure); and the items
 * nothing published covers, careful ones and downgrades left out: the content
 * gaps Insights reads.
 */
export interface MatchCounts {
  runs: number;
  byKind: Record<MatchKind, { runs: number; handoffs: number; handoffRate: number | null }>;
  rows: number;
  downgraded: number;
  downgradedRate: number | null;
  gaps: number;
}

export function matchCounts(
  rows: readonly { match: AnswerTrace["match"] | null; handoffConfirmed: boolean }[],
): MatchCounts {
  const tally = new Map(MATCH_KINDS.map((kind) => [kind, { runs: 0, handoffs: 0 }]));
  let shown = 0;
  let downgraded = 0;
  let gaps = 0;
  for (const { match, handoffConfirmed } of rows) {
    const kind = match && tally.get(match.kind);
    if (!kind) continue;
    kind.runs++;
    if (handoffConfirmed) kind.handoffs++;
    for (const item of match.items) {
      if (item.status !== null) shown++;
      if (item.downgraded) downgraded++;
      else if (item.status === "not-published" && !item.careful) gaps++;
    }
  }
  const byKind = Object.fromEntries(
    [...tally].map(([kind, t]) => [kind, { ...t, handoffRate: share(t.handoffs, t.runs) }]),
  ) as MatchCounts["byKind"];
  return {
    runs: [...tally.values()].reduce((sum, t) => sum + t.runs, 0),
    byKind,
    rows: shown,
    downgraded,
    downgradedRate: share(downgraded, shown),
    gaps,
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
