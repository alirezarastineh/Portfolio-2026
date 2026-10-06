import type {
  AnswersRow,
  AssistantUsage,
  GuardEventRow,
  ToolOutcome,
  TraceStep,
} from "./assistant-types";

/**
 * How the admin reads an answer's trace and the assistant's audit signals:
 * one line per step, the tone of each tool's outcome, the primary model's
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
  if (outcome === "ok") return "ok";
  return outcome === "not_allowed" || outcome === "error" ? "bad" : "warn";
}

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)} %` : "0 %";
}

/** Who answered the step, how fast, what it read and wrote, how it ended. */
export function stepLine(step: TraceStep): string {
  const parts = [step.model ?? "no model could answer"];
  if (step.answerOnly) parts.push("answer-only");
  if (step.ttftMs !== null) parts.push(`${count.format(step.ttftMs)} ms to first token`);
  if (step.tokens) {
    const { input, cached, output } = step.tokens;
    parts.push(
      `${count.format(input)} in (${percent(cached, input)} cached)`,
      `${count.format(output)} out`,
    );
  }
  if (step.finishReason) parts.push(step.finishReason);
  return parts.join(" · ");
}

/** The models a step passed over before one answered, or null when none were. */
export function passedOverLine(step: TraceStep): string | null {
  if (!step.passedOver.length) return null;
  return step.passedOver.map((p) => `${p.model} ${p.outcome} (${p.ms} ms)`).join(" → ");
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

/** Requests turned away, per day, newest first. */
export function refusalsByDay(rows: readonly GuardEventRow[]): RefusalDay[] {
  const days = new Map<string, GuardEventRow[]>();
  for (const row of rows) days.set(row.day, [...(days.get(row.day) ?? []), row]);
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
  for (const row of rows) totals.set(row.kind, (totals.get(row.kind) ?? 0) + row.count);
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
  const { answers, count, rate } = shareOf(rows, "withDropped");
  return { answers, withDropped: count, rate };
}

/** The share of the period's answers a count covers (older API rows count as zero). */
export function shareOf(
  rows: readonly AnswersRow[],
  field: "withDropped" | "flagged",
): { answers: number; count: number; rate: number } {
  let answers = 0;
  let count = 0;
  for (const row of rows) {
    answers += row.answers;
    count += row[field] ?? 0;
  }
  return { answers, count, rate: answers ? count / answers : 0 };
}

const CHECK_LABELS: Record<string, string> = {
  language: "wrong language",
  uncited: "uncited",
  leak: "prompt leak",
  empty: "empty",
  "invented-citation": "invented citation",
  "max-rounds": "used every round",
  degraded: "fallback answered",
  blocked: "blocked by the filter",
  "injection-attempt": "injection attempt",
};

/** A check flag in words (`server/src/ask/checks.ts` defines them). */
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
  for (const m of usage.models) row(m.day).usd += m.usd;
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}
