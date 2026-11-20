import type { AssistantHealth, BreakerRow, SpendToday } from "./assistant-types";
import { seconds, share } from "./outcomes";
import { offWords } from "./pulse.service";
import { typedAt } from "./recovery.service";
import { featureLabel, stateLabel } from "./spending";

/**
 * Now, the Assistant's first view (plan 5, U18), in words: the state, today's spend by feature and
 * each model. Pure, so its sentences are tested apart from the page.
 */

/** A row of "Waits for you" with its own button (trust's alerts and demotions, the insights notice). */
export const WAITING_ROW =
  "flex min-h-9 items-center justify-between gap-3 border-b border-border py-1.5 pl-3 pr-2 text-sm pointer-coarse:min-h-11";

/** A queue's row: one link, so the whole row is the target (Today's row, without its time). */
export const QUEUE_ROW =
  "grid w-full min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border py-1.5 pl-3 pr-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2 pointer-coarse:min-h-11";

/** What follows item `index` of "a, b and c.": a comma, "and" before the last, a full stop after it. */
export function joiner(index: number, length: number): string {
  if (index === length - 1) {
    return ".";
  }
  return index === length - 2 ? " and " : ", ";
}

/** "1 answer", "3 answers". */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "14:02" today, "8 Nov, 14:02" before: the admin's one clock. */
const clock = (iso: string) => typedAt(Date.parse(iso));

/** Dollars to the cent; a sliver of a cent still shows as spent (Today's rule). */
export function usd(value: number): string {
  if (value > 0 && value < 0.01) {
    return "<$0.01";
  }
  return `$${value.toFixed(2)}`;
}

/** How it stands: answering (with any trouble), resting or off. The icon follows `tone`. */
export interface StateLine {
  tone: "ok" | "warn" | "off";
  words: string;
}

function dayWords({ answers, failures, fallbackRate }: AssistantHealth["last24h"]): string {
  if (!answers) {
    return "No answers in the last 24 hours.";
  }
  const failed = failures ? `${failures} failed` : "none failed";
  const answered = count(answers, "answer", "answers");
  return `${answered} in the last 24 hours: ${failed}, ${share(fallbackRate)} from a fallback model.`;
}

function pausedWords(paused: number): string {
  if (!paused) {
    return "Answering.";
  }
  return paused === 1 ? "Answering, one model paused." : `Answering, ${paused} models paused.`;
}

export function stateLine(health: AssistantHealth): StateLine {
  const { state, last24h, inFlight } = health;
  const day = dayWords(last24h);
  if (state.state === "off") {
    return { tone: "off", words: `Off: ${offWords(state.reason)}. ${day}` };
  }
  if (state.state === "resting") {
    const budget = usd(state.budgetUsd);
    return { tone: "warn", words: `Resting: today's budget of ${budget} is spent. ${day}` };
  }
  const paused = health.breakers.filter((b) => b.state === "open").length;
  const words = [
    pausedWords(paused),
    day,
    inFlight ? `${count(inFlight, "answer", "answers")} streaming now.` : "",
    state.deepAllowed
      ? ""
      : "The deep model is off: over 80 % of the budget is spent, or Settings turned it off.",
  ];
  return {
    tone: paused || last24h.failures ? "warn" : "ok",
    words: words.filter(Boolean).join(" "),
  };
}

/** A sum as a share of the day's budget, 0 to 1: every bar on Now shares that scale. */
export function shareOf(spend: Pick<SpendToday, "budgetUsd">, value: number): number {
  return spend.budgetUsd > 0 ? Math.min(1, value / spend.budgetUsd) : 0;
}

/** One feature's spend today: its `share` of the budget, and why it stopped. */
export interface SpendRow {
  feature: string;
  label: string;
  spentUsd: number;
  share: number;
  stopped: string | null;
}

/** A bar per feature that spent today or stopped at its own cap, the most spent first. */
export function spendRows(spend: SpendToday): SpendRow[] {
  return spend.features
    .filter((f) => f.spentUsd > 0 || f.state === "cap")
    .map((f) => ({
      feature: f.feature,
      label: featureLabel(f.feature),
      spentUsd: f.spentUsd,
      share: shareOf(spend, f.spentUsd),
      stopped: f.state === "ok" ? null : stateLabel(f.state),
    }))
    .sort((a, b) => b.spentUsd - a.spentUsd);
}

/** The features switched off in Settings, by name. */
export const switchedOff = (spend: SpendToday): string[] =>
  spend.features.filter((f) => f.switchedOn === false).map((f) => featureLabel(f.feature));

/** A model in words; `error` is the provider's own text while it matters. */
export interface ModelLine {
  model: string;
  tone: "ok" | "warn" | "trying";
  words: string;
  error: string | null;
}

const ORDER: Record<ModelLine["tone"], number> = { warn: 0, trying: 1, ok: 2 };

type ModelStats = AssistantHealth["last24h"]["models"][number];

/** "; first word in 0.4 s, 1.3 s for the slowest 1 in 20": p50 and p95, said in place. */
function speedWords(stats: ModelStats | undefined): string {
  const typical = stats?.p50TtftMs ?? null;
  const slow = stats?.p95TtftMs ?? null;
  if (typical === null || slow === null) {
    return "";
  }
  return `; first word in ${seconds(typical)}, ${seconds(slow)} for the slowest 1 in 20`;
}

function modelLine(b: BreakerRow, stats: ModelStats | undefined): ModelLine {
  const lastAt = b.lastFailureAt ? ` at ${clock(b.lastFailureAt)}` : "";
  if (b.state === "open") {
    const until = b.openUntil ? `, until ${clock(b.openUntil)}` : "";
    const failures = count(b.consecutiveFailures, "failure", "failures");
    return {
      model: b.model,
      tone: "warn",
      words: `paused after ${failures}${lastAt}${until}`,
      error: b.lastError,
    };
  }
  if (b.state === "half-open") {
    const words = "trying again: the next question tests it";
    return { model: b.model, tone: "trying", words, error: b.lastError };
  }
  if (b.consecutiveFailures) {
    const times = count(b.consecutiveFailures, "time", "times");
    const last = b.lastFailureAt ? `, last${lastAt}` : "";
    const words = `answering; failed ${times} in a row${last}${speedWords(stats)}`;
    return { model: b.model, tone: "warn", words, error: b.lastError };
  }
  return { model: b.model, tone: "ok", words: `answering${speedWords(stats)}`, error: null };
}

/** Each configured model, the ones in trouble first. */
export function modelLines(health: Pick<AssistantHealth, "breakers" | "last24h">): ModelLine[] {
  const stats = new Map(health.last24h.models.map((m) => [m.model, m]));
  return health.breakers
    .map((b) => modelLine(b, stats.get(b.model)))
    .sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
}
