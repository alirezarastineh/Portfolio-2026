import type {
  AnswersRow,
  AssistantUsage,
  Attempt,
  ConversationRow,
  GuardEventRow,
  ToolOutcome,
  TraceStep,
} from "./assistant-types";

/**
 * How the admin reads an answer's trace and the assistant's audit signals:
 * a sentence per step, the tone of each tool's outcome, the primary model's
 * cache hits per day (with the 50 % warning line), refusals at the gate and
 * the invented-citation rate. Pure, so the components stay thin.
 */

export type Tone = "ok" | "warn" | "bad";

/** Below this share of cached input the fixed prefix is not being reused. */
export const CACHE_WARNING = 0.5;

const OUTCOME_LABELS: Record<ToolOutcome, string> = {
  ok: "ok",
  not_found: "not found",
  not_allowed: "not allowed",
  no_hits: "no hits",
  error: "error",
  "cut-off": "cut off",
  duplicate: "already provided",
  budget_exhausted: "budget spent",
};

const count = new Intl.NumberFormat("en-US");

export function toolOutcomeLabel(outcome: ToolOutcome): string {
  return OUTCOME_LABELS[outcome] ?? outcome;
}

/** A refusal or a failure is bad; finding nothing, or being cut off, is worth a look. */
export function toolTone(outcome: ToolOutcome): Tone {
  if (outcome === "ok") {
    return "ok";
  }
  return outcome === "not_allowed" || outcome === "error" ? "bad" : "warn";
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)} %` : "0 %";
}

const tenths = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 5,
});

/** "2.9 s". */
export function seconds(ms: number): string {
  return `${tenths.format(ms / 1000)} s`;
}

/** "$0.0079": an answer costs fractions of a cent. */
export function cost(usd: number): string {
  return dollars.format(usd);
}

/** A model attempt's outcome (`server/src/ask/models/fallback.ts`), as a verb phrase. */
const ATTEMPT_WORDS = new Map<string, string>([
  ["ok", "answered"],
  ["rate-limited", "was rate-limited"],
  ["server-error", "had a server error"],
  ["client-error", "refused the request"],
  ["network", "could not be reached"],
  ["timeout", "timed out"],
  ["skipped-open", "was paused after failures"],
  ["skipped-missing", "is not set up here"],
  ["skipped-capability", "cannot call tools"],
  ["skipped-context", "had no room for the request"],
]);

/** How an answer or a step ended (`resolveFinishReason`, `server/src/ask/agent.ts`). */
const FINISH_WORDS = new Map<string, string>([
  ["stop", "finished"],
  ["tool-calls", "called tools"],
  ["length", "stopped at its length limit"],
  ["content-filter", "was blocked by the safety filter"],
  ["aborted", "was stopped by the visitor"],
  ["error:unavailable", "failed: no model was available"],
  ["error:timeout", "failed: it timed out"],
  ["error:error", "failed"],
  ["error", "failed"],
]);

export function attemptWords(outcome: string): string {
  return ATTEMPT_WORDS.get(outcome) ?? outcome;
}

export function finishWords(reason: string): string {
  return FINISH_WORDS.get(reason) ?? `ended (${reason})`;
}

/** One step in a sentence: who answered, how fast, what it read and wrote, how it ended. */
export function stepSentence(step: TraceStep): string {
  const parts: string[] = [];
  if (step.answerOnly) {
    parts.push("answering without tools");
  }
  if (step.ttftMs !== null) {
    parts.push(`first word after ${seconds(step.ttftMs)}`);
  }
  if (step.tokens) {
    const { input, cached, output } = step.tokens;
    parts.push(
      `${count.format(input)} tokens read (${percent(cached, input)} from the cache)`,
      `${count.format(output)} written`,
    );
  }
  const who = step.model ?? "No model could answer";
  const said = parts.length > 0 ? `${who}: ${parts.join(", ")}` : who;
  return step.finishReason ? `${said}, then it ${finishWords(step.finishReason)}.` : `${said}.`;
}

/** The models a step passed over before one answered, in a sentence, or null when none were. */
export function passedOverSentence(step: TraceStep): string | null {
  if (step.passedOver.length === 0) {
    return null;
  }
  return `Passed over first: ${step.passedOver.map((p) => attemptSentence(p)).join("; ")}.`;
}

function attemptSentence(attempt: Attempt): string {
  const after = attempt.ms > 0 ? ` after ${seconds(attempt.ms)}` : "";
  return `${attempt.model} ${attemptWords(attempt.outcome)}${after}`;
}

/**
 * The facts of an answer, in sentences: where it was asked, how fast and at what cost it came,
 * and the models tried for it when there was more than one.
 */
export function answerFacts(row: ConversationRow): string[] {
  const language = row.locale === "de" ? "German" : "English";
  const first = row.ttftMs === null ? "" : `, its first word after ${seconds(row.ttftMs)}`;
  const { input, cached, output } = row.tokens;
  const facts = [
    `Asked in ${language}, session ${row.session}, on the ${row.route} route, prompt ${row.promptVersion}.`,
    `Answered in ${seconds(row.totalMs)}${first}: ${count.format(input)} tokens read (${percent(cached, input)} from the cache), ${count.format(output)} written, ${cost(row.usd)}.`,
  ];
  if (row.attempts.length > 1) {
    facts.push(`Models tried: ${row.attempts.map((a) => attemptSentence(a)).join("; ")}.`);
  }
  return facts;
}

/** A matched brief (visitor plan V20): "match: role, 5 rows, 1 taken back". */
function matchWords(row: ConversationRow): string | null {
  const match = row.route === "match" ? row.trace?.match : undefined;
  if (!match) {
    return null;
  }
  const rows = match.items.filter((item) => item.status !== null).length;
  const back = match.items.filter((item) => item.downgraded).length;
  return [
    `match: ${match.kind}`,
    rows === 1 ? "1 row" : `${rows} rows`,
    back ? `${back} taken back` : "",
    match.stop ? `stopped: ${match.stop}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** What happened to an answer, worst first, in words; null when nothing did. */
export function happenedWords(row: ConversationRow): string | null {
  const words: string[] = [];
  if (row.finishReason.startsWith("error") || row.finishReason === "aborted") {
    words.push(finishWords(row.finishReason));
  }
  if (row.feedback !== null) {
    words.push(row.feedback === 1 ? "thumbs up" : "thumbs down");
  }
  const dropped = row.droppedCitations.length;
  // The check's "invented citation" says less than the count of those removed.
  const flags = (row.checks?.flags ?? []).filter((f) => !dropped || f !== "invented-citation");
  words.push(...flags.map((flag) => checkLabel(flag)));
  if (dropped) {
    words.push(`${dropped} invented ${dropped === 1 ? "citation" : "citations"} removed`);
  }
  const match = matchWords(row);
  if (match) {
    words.push(match);
  }
  const said = words.join(", ");
  return said ? `${said.slice(0, 1).toUpperCase()}${said.slice(1)}` : null;
}

export interface CacheDay {
  day: string;
  /** Cached share of the primary model's input; null on a day it did not answer. */
  share: number | null;
  warn: boolean;
}

/** The primary model's cache hits per day, newest first. */
export function cacheDays(rows: readonly AnswersRow[]): CacheDay[] {
  return rows
    .map((row) => {
      const input = row.primaryInput ?? 0;
      const share = input ? (row.primaryCached ?? 0) / input : null;
      return { day: row.day, share, warn: share !== null && share < CACHE_WARNING };
    })
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** The cached share over every day at once, or null when the primary model gave no answer. */
export function cacheShare(rows: readonly AnswersRow[]): number | null {
  let input = 0;
  let cached = 0;
  for (const row of rows) {
    input += row.primaryInput ?? 0;
    cached += row.primaryCached ?? 0;
  }
  return input ? cached / input : null;
}

export interface RefusalDay {
  day: string;
  total: number;
  /** "rate_limited 3 · busy 1", most frequent first. */
  kinds: string;
}

/**
 * A guard event that is no refusal: a visitor deleted their conversation
 * (`forget`, visitor plan V14), counted beside the refusals, never as one.
 */
const NOT_REFUSED = new Set(["forgotten"]);

/** Requests turned away, per day, newest first. */
export function refusalsByDay(rows: readonly GuardEventRow[]): RefusalDay[] {
  const days = new Map<string, GuardEventRow[]>();
  for (const row of rows) {
    if (!NOT_REFUSED.has(row.kind)) {
      days.set(row.day, [...(days.get(row.day) ?? []), row]);
    }
  }
  return [...days]
    .map(([day, kinds]) => ({
      day,
      total: kinds.reduce((sum, k) => sum + k.count, 0),
      kinds: [...kinds]
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
        .map((k) => `${k.kind} ${k.count}`)
        .join(" · "),
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

/** Totals per kind over the period, most frequent first. */
export function refusalTotals(rows: readonly GuardEventRow[]): { kind: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!NOT_REFUSED.has(row.kind)) {
      totals.set(row.kind, (totals.get(row.kind) ?? 0) + row.count);
    }
  }
  return [...totals]
    .map(([kind, n]) => ({ kind, count: n }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

/** How many answers had a citation the model made up, over the period. */
export function droppedRate(rows: readonly AnswersRow[]): {
  answers: number;
  withDropped: number;
  rate: number;
} {
  const { answers, count: withDropped, rate } = shareOf(rows, "withDropped");
  return { answers, withDropped, rate };
}

/** The share of the period's answers a count covers (older API rows count as zero). */
export function shareOf(
  rows: readonly AnswersRow[],
  field: "withDropped" | "flagged",
): { answers: number; count: number; rate: number } {
  let answers = 0;
  let total = 0;
  for (const row of rows) {
    answers += row.answers;
    total += row[field] ?? 0;
  }
  return { answers, count: total, rate: answers ? total / answers : 0 };
}

const CHECK_LABELS: Record<string, string> = {
  language: "wrong language",
  uncited: "uncited",
  leak: "prompt leak",
  empty: "empty",
  "invented-citation": "invented citation",
  // Visitor plan V7: a figure that no cited document holds.
  "ungrounded-figure": "ungrounded figure",
  "max-rounds": "used every round",
  degraded: "fallback answered",
  blocked: "blocked by the filter",
  // Visitor plan V5: no words at first, then one more call or the fixed closing line.
  repaired: "repaired: no words at first",
  "injection-attempt": "injection attempt",
};

/** Why a thumbs-down, as the visitor chose it (`FEEDBACK_REASONS` on the server, visitor plan V2). */
const DOWN_REASONS: Record<string, string> = {
  wrong: "thumbs down: wrong or made up",
  unanswered: "thumbs down: didn't answer the question",
  length: "thumbs down: too long or too short",
};

/** A check flag in words (`server/src/ask/checks.ts` defines them). */
/** A review queue reason in words: a check's flag, the judge's verdict, or people's signals as they are. */
export function reasonLabel(reason: string): string {
  // The nightly judge found it unfaithful (plan phase 26).
  if (reason === "judge:unfaithful") {
    return "judged unfaithful";
  }
  // The visitor's own signals (visitor plan V2): a thumbs-down's reason, a stop mid-answer.
  if (reason.startsWith("thumbs down:")) {
    return DOWN_REASONS[reason.slice("thumbs down:".length)] ?? "thumbs down";
  }
  if (reason === "stopped") {
    return "stopped mid-answer";
  }
  return reason.startsWith("check:") ? checkLabel(reason.slice("check:".length)) : reason;
}

export function checkLabel(flag: string): string {
  return CHECK_LABELS[flag] ?? flag;
}

/** A leak (removed by the guard or shown), a wrong language, an empty answer: bad; the rest worth a look. */
export function checkTone(flag: string): Tone {
  return flag === "leak" || flag === "language" || flag === "empty" ? "bad" : "warn";
}

/** One day of the Overview's table. */
export interface DayRow {
  day: string;
  answers: number;
  up: number;
  down: number;
  usd: number;
  /** The primary model's cached share of input; null on a day it gave no answer. */
  cache: number | null;
  cacheWarn: boolean;
  refused: number;
  refusedKinds: string;
  withDropped: number;
  flagged: number;
}

/**
 * Every day that had answers, spend or refusals, newest first: the answers'
 * counts and signals, the models' cost, the gate's refusals.
 */
export function dayRows(
  usage: Pick<AssistantUsage, "answers" | "models"> & Partial<Pick<AssistantUsage, "guardEvents">>,
): DayRow[] {
  const byDay = new Map<string, DayRow>();
  const row = (day: string): DayRow => {
    let found = byDay.get(day);
    if (!found) {
      found = {
        day,
        answers: 0,
        up: 0,
        down: 0,
        usd: 0,
        cache: null,
        cacheWarn: false,
        refused: 0,
        refusedKinds: "",
        withDropped: 0,
        flagged: 0,
      };
      byDay.set(day, found);
    }
    return found;
  };
  for (const a of usage.answers) {
    Object.assign(row(a.day), {
      answers: a.answers,
      up: a.up,
      down: a.down,
      withDropped: a.withDropped ?? 0,
      flagged: a.flagged ?? 0,
    });
  }
  for (const c of cacheDays(usage.answers)) {
    Object.assign(row(c.day), { cache: c.share, cacheWarn: c.warn });
  }
  for (const r of refusalsByDay(usage.guardEvents ?? [])) {
    Object.assign(row(r.day), { refused: r.total, refusedKinds: r.kinds });
  }
  for (const m of usage.models) {
    row(m.day).usd += m.usd;
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}
