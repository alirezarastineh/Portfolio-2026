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

export interface OutcomesView {
  days: number;
  outcomes: Outcomes;
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

/** Offered → confirmed → sent, with the share that made each step. */
export function funnelLine(funnel: Outcomes["funnel"]): string {
  const step = (part: number, whole: number) =>
    whole ? ` (${Math.round((part / whole) * 100)} %)` : "";
  return `${funnel.offered} offered → ${funnel.confirmed} confirmed${step(funnel.confirmed, funnel.offered)} → ${funnel.sent} sent${step(funnel.sent, funnel.confirmed)}`;
}
