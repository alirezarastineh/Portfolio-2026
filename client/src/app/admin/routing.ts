/**
 * The router's report as the Overview shows it (plan phase 20): how visitor
 * answers were routed, how each tier fared, and the false-simple rate with
 * its candidates. The shapes mirror `server/src/ask/router-report.ts` and
 * `GET /admin/assistant/router`.
 */

import { percent } from "./perception";

export type RouteTier = "lookup" | "lite" | "deep" | "escalated" | "answer-only";
export type FalseSimpleReason = "flagged" | "thumbs-down" | "rephrased";

export interface TierStats {
  tier: RouteTier;
  answers: number;
  p50TtftMs: number | null;
  p90TtftMs: number | null;
  usdPerAnswer: number | null;
  helpfulRate: number | null;
}

export interface FalseSimple {
  id: string;
  createdAt: string;
  question: string;
  tier: "lookup" | "lite";
  reasons: FalseSimpleReason[];
}

export interface RouterView {
  days: number;
  answers: number;
  tiers: TierStats[];
  sensitive: { answers: number; byTopic: Record<string, number> };
  escalation: { answers: number; rate: number | null; byReason: Record<string, number> };
  falseSimple: {
    rate: number | null;
    kept: number;
    candidates: number;
    byReason: Record<FalseSimpleReason, number>;
    listed: FalseSimple[];
  };
}

export const TIER_LABELS: Record<RouteTier, string> = {
  lookup: "Lookup (minimal thinking)",
  lite: "Lite",
  escalated: "Lite, moved up to deep",
  deep: "Deep",
  "answer-only": "Answer-only (no tools)",
};

export const REASON_LABELS: Record<FalseSimpleReason, string> = {
  flagged: "flagged",
  "thumbs-down": "thumbs-down",
  rephrased: "rephrased",
};

const ESCALATION_LABELS: Record<string, string> = {
  "projects-fetched": "fetched two projects",
  "search-spans-projects": "a search spanned two projects",
};

const TOPIC_LABELS: Record<string, string> = {
  compensation: "pay and rates",
  immigration: "visas and permits",
  contract: "contracts and clients",
  health: "health",
  family: "family",
  politics: "politics",
  private: "private details",
};

/** Milliseconds as seconds, one decimal: "1.2 s". */
export function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

export interface TierRow {
  tier: RouteTier;
  label: string;
  answers: number;
  ttft: string;
  usdPerAnswer: string;
  helpful: string;
}

/** The tiers with answers, in the report's order, formatted for the table. */
export function tierRows(view: RouterView): TierRow[] {
  return view.tiers
    .filter((t) => t.answers > 0)
    .map((t) => ({
      tier: t.tier,
      label: TIER_LABELS[t.tier],
      answers: t.answers,
      ttft: `${seconds(t.p50TtftMs)} / ${seconds(t.p90TtftMs)}`,
      usdPerAnswer: t.usdPerAnswer === null ? "–" : `$${t.usdPerAnswer.toFixed(5)}`,
      helpful: percent(t.helpfulRate),
    }));
}

/** "3 of 40 answers kept on the lite route went wrong (8 %): 1 flagged, 2 rephrased", or null. */
export function falseSimpleLine(view: RouterView): string | null {
  const f = view.falseSimple;
  if (!f.kept) return null;
  const why = (Object.keys(REASON_LABELS) as FalseSimpleReason[])
    .filter((r) => f.byReason[r])
    .map((r) => `${f.byReason[r]} ${REASON_LABELS[r]}`)
    .join(", ");
  const noun = f.kept === 1 ? "answer" : "answers";
  const detail = why ? `: ${why}` : "";
  return `${f.candidates} of ${f.kept} ${noun} kept on the lite route went wrong (${percent(f.rate)})${detail}`;
}

/** "2 of 25 routed lite moved up (8 %): 1 fetched two projects, …", or null without any. */
export function escalationLine(view: RouterView): string | null {
  const e = view.escalation;
  if (!e.answers) return null;
  const why = Object.entries(e.byReason)
    .map(([reason, n]) => `${n} ${ESCALATION_LABELS[reason] ?? reason}`)
    .join(", ");
  const detail = why ? `: ${why}` : "";
  return `${e.answers} moved up to the deep chain mid-answer (${percent(e.rate)} of those routed lite)${detail}`;
}

/** "Careful answers: 3 (pay and rates 2, family 1)", or null without any. */
export function sensitiveLine(view: RouterView): string | null {
  const s = view.sensitive;
  if (!s.answers) return null;
  const topics = Object.entries(s.byTopic)
    .sort(([, a], [, b]) => b - a)
    .map(([topic, n]) => `${TOPIC_LABELS[topic] ?? topic} ${n}`)
    .join(", ");
  return `Careful answers (the newspaper test): ${s.answers} (${topics})`;
}
