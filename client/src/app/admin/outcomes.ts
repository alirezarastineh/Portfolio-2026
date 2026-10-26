/**
 * The assistant's outcomes as the Overview shows them. The shapes mirror
 * `server/src/ask/outcomes.ts` and `GET /admin/assistant/outcomes`.
 */

export const PRIMARY_METRICS = [
  "helpfulRate",
  "thumbsUpRate",
  "unknownRate",
  "rephraseRate",
] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export interface Outcomes {
  answers: number;
  answered: number;
  helpful: number;
  funnel: { offered: number; confirmed: number; sent: number };
  rated: { up: number; down: number };
  helpfulRate: number | null;
  thumbsUpRate: number | null;
  unknownRate: number | null;
  rephraseRate: number | null;
  usd: number;
  costPerAnswered: number | null;
  costPerHelpful: number | null;
}

/** Why a thumbs-down, as the terminal offers them (`FEEDBACK_REASONS` on the server). */
export type DownReason = "wrong" | "unanswered" | "length";

/**
 * What the visitors' browsers saw (`browserView`, visitor plan V2): the first visible word beside
 * the server's first token for the same answers, and what visitors did with the answers.
 */
export interface BrowserView {
  reported: number;
  shownP50Ms: number | null;
  shownP95Ms: number | null;
  serverP50Ms: number | null;
  serverP95Ms: number | null;
  stopRate: number | null;
  copyRate: number | null;
  followupRate: number | null;
  citationRate: number | null;
  retried: number;
  downReasons: Record<DownReason | "none", number>;
}

export interface OutcomesView {
  days: number;
  outcomes: Outcomes;
  /** Absent from an API older than the visitor plan's V2. */
  browser?: BrowserView;
  /** The guided tours (visitor plan V16); absent from an older API. */
  tours?: TourCounts;
  primary: {
    metric: PrimaryMetric;
    weeks: { week: string; value: number | null }[];
    rotate: boolean;
  };
  metrics: PrimaryMetric[];
}

export const METRIC_LABELS: Record<PrimaryMetric, string> = {
  helpfulRate: "Helpful answers",
  thumbsUpRate: "👍 among rated",
  unknownRate: "“Not in the portfolio”",
  rephraseRate: "Asked again within 2 min",
};

/** Which way is better, for the arrow next to a value. */
export const HIGHER_IS_BETTER: Record<PrimaryMetric, boolean> = {
  helpfulRate: true,
  thumbsUpRate: true,
  unknownRate: false,
  rephraseRate: false,
};

export function share(value: number | null): string {
  return value === null ? "–" : `${Math.round(value * 100)} %`;
}

export function usd(value: number | null): string {
  return value === null ? "–" : `$${value.toFixed(4)}`;
}

/** A time in seconds, to a tenth; "–" for none. */
export function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

/** The browser's tiles: what visitors saw and did (visitor plan V2). */
export function browserTiles(b: BrowserView): { label: string; value: string; detail?: string }[] {
  return [
    {
      label: "First word, as visitors saw it (p50 / p95)",
      value: `${seconds(b.shownP50Ms)} / ${seconds(b.shownP95Ms)}`,
      detail: `the server's first token: ${seconds(b.serverP50Ms)} / ${seconds(b.serverP95Ms)}`,
    },
    { label: "Stopped mid-answer", value: share(b.stopRate) },
    {
      label: "Follow-ups clicked",
      value: share(b.followupRate),
      detail: "of answers offering them",
    },
    { label: "Citations followed", value: share(b.citationRate), detail: "of answers citing" },
    { label: "Copied", value: share(b.copyRate) },
    { label: "Asked again after a failure", value: String(b.retried) },
  ];
}

const DOWN_REASON_WORDS: Record<DownReason | "none", string> = {
  wrong: "wrong or made up",
  unanswered: "didn't answer",
  length: "too long or too short",
  none: "no reason given",
};

/** "👎 by reason: 2 wrong or made up, 1 didn't answer, …"; null when there was no 👎. */
export function downReasonLine(b: BrowserView): string | null {
  const parts = (Object.keys(DOWN_REASON_WORDS) as (DownReason | "none")[])
    .filter((reason) => b.downReasons[reason] > 0)
    .map((reason) => `${b.downReasons[reason]} ${DOWN_REASON_WORDS[reason]}`);
  return parts.length ? `👎 by reason: ${parts.join(", ")}` : null;
}

/** The tours planned for an interest, and the share taken to the last stop (`tourCounts`, V16). */
export interface TourCounts {
  started: number;
  finished: number;
  finishedRate: number | null;
}

/** "3 tours planned, 1 taken to the last stop (33 %)". */
export function tourLine(t: TourCounts): string {
  const planned = t.started === 1 ? "1 tour planned" : `${t.started} tours planned`;
  return t.started
    ? `${planned}, ${t.finished} taken to the last stop (${share(t.finishedRate)})`
    : "No tour planned yet";
}

/** Offered → confirmed → sent, with the share that made each step. */
export function funnelLine(funnel: Outcomes["funnel"]): string {
  const step = (part: number, whole: number) =>
    whole ? ` (${Math.round((part / whole) * 100)} %)` : "";
  return `${funnel.offered} offered → ${funnel.confirmed} confirmed${step(funnel.confirmed, funnel.offered)} → ${funnel.sent} sent${step(funnel.sent, funnel.confirmed)}`;
}
