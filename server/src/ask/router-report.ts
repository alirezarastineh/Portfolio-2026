import type { CheckFlag } from "./checks.js";
import { isAnswered, isHelpful, rephrased, type OutcomeRow } from "./outcomes.js";
import { ESCALATED_ROUTE } from "./router.js";

/**
 * The router's report (plan phase 20): how a window's visitor answers were
 * routed and how each tier fared. Its centre is the book's measure of a
 * router's costly error, the false-simple rate: answers the router kept on
 * the lite route (a lookup included) that then went wrong (a flag a stronger
 * model might have avoided, a thumbs-down, a rephrase), out of all it kept
 * there. Each such
 * answer is listed, so the admin can freeze it as a case and replay it on the
 * deep chain (`ai:eval --suite production --on deep`). Pure: the admin route
 * loads the rows.
 */

/** One terminal answer as the report reads it: its outcome, route, speed and routing. */
export interface RouterRow extends OutcomeRow {
  /** The logged route: `lite`, `deep`, `lite→deep` or `answer-only`. */
  route: string;
  ttftMs: number | null;
  /** The trace's routing (missing on answers from before phase 20). */
  routing: { reason?: string; sensitive?: string; lookup?: boolean } | null;
  /** Why the answer moved up mid-way, when it did. */
  escalation: string | null;
}

export type RouteTier = "lookup" | "lite" | "deep" | "escalated" | "answer-only";

export const ROUTE_TIERS: readonly RouteTier[] = [
  "lookup",
  "lite",
  "escalated",
  "deep",
  "answer-only",
];

export function tierOf(row: Pick<RouterRow, "route" | "routing">): RouteTier {
  if (row.route === "answer-only") return "answer-only";
  if (row.route === ESCALATED_ROUTE) return "escalated";
  if (row.route === "deep") return "deep";
  return row.routing?.lookup ? "lookup" : "lite";
}

export interface TierStats {
  tier: RouteTier;
  answers: number;
  /** Time to the first token, over the answered ones. */
  p50TtftMs: number | null;
  p90TtftMs: number | null;
  usdPerAnswer: number | null;
  helpfulRate: number | null;
}

export type FalseSimpleReason = "flagged" | "thumbs-down" | "rephrased";

export interface FalseSimple {
  id: string;
  createdAt: string;
  question: string;
  tier: "lookup" | "lite";
  reasons: FalseSimpleReason[];
}

export interface RouterReport {
  answers: number;
  tiers: TierStats[];
  /** Answers the newspaper test sent through the careful block, by topic. */
  sensitive: { answers: number; byTopic: Record<string, number> };
  /** Answers routed lite that moved up mid-way, of all routed lite (a lookup included). */
  escalation: { answers: number; rate: number | null; byReason: Record<string, number> };
  falseSimple: {
    /** Of the answered ones kept on the lite route. */
    rate: number | null;
    kept: number;
    candidates: number;
    byReason: Record<FalseSimpleReason, number>;
    /** The newest first, at most `LISTED`. */
    listed: FalseSimple[];
  };
}

/** How many false-simple candidates the report lists. */
export const LISTED = 25;

/** The `p`-th percentile (0–1) by nearest rank; null for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

const share = (part: number, whole: number) => (whole ? part / whole : null);

/**
 * The flags a stronger model might have avoided: nothing grounded, nothing
 * said, a citation made up, every round used. A fallback that answered, a
 * provider's block, a leak or the wrong language says nothing about the route.
 */
const UNDER_SERVED: readonly CheckFlag[] = ["uncited", "empty", "invented-citation", "max-rounds"];

function falseSimpleReasons(row: RouterRow, again: ReadonlySet<string>): FalseSimpleReason[] {
  const reasons: FalseSimpleReason[] = [];
  if (row.flags.some((flag) => (UNDER_SERVED as readonly string[]).includes(flag))) {
    reasons.push("flagged");
  }
  if (row.feedback === -1) reasons.push("thumbs-down");
  if (again.has(row.id)) reasons.push("rephrased");
  return reasons;
}

function tierStats(tier: RouteTier, rows: readonly RouterRow[], again: ReadonlySet<string>) {
  const answered = rows.filter(isAnswered);
  const ttft = answered.flatMap((row) => (row.ttftMs === null ? [] : [row.ttftMs]));
  return {
    tier,
    answers: rows.length,
    p50TtftMs: percentile(ttft, 0.5),
    p90TtftMs: percentile(ttft, 0.9),
    usdPerAnswer: share(
      rows.reduce((sum, row) => sum + row.usd, 0),
      rows.length,
    ),
    helpfulRate: share(answered.filter((row) => isHelpful(row, again)).length, answered.length),
  } satisfies TierStats;
}

function count<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function routerReport(rows: readonly RouterRow[]): RouterReport {
  const again = rephrased(rows);
  const byTier = new Map<RouteTier, RouterRow[]>(ROUTE_TIERS.map((tier) => [tier, []]));
  for (const row of rows) byTier.get(tierOf(row))!.push(row);

  // Kept simple: lite or lookup, answered, and never moved up.
  const kept = [...byTier.get("lite")!, ...byTier.get("lookup")!].filter(isAnswered);
  const candidates = kept
    .map((row) => ({ row, reasons: falseSimpleReasons(row, again) }))
    .filter(({ reasons }) => reasons.length > 0)
    .sort((a, b) => b.row.createdAt.getTime() - a.row.createdAt.getTime());
  const byReason: Record<FalseSimpleReason, number> = {
    flagged: 0,
    "thumbs-down": 0,
    rephrased: 0,
  };
  for (const { reasons } of candidates) for (const reason of reasons) byReason[reason]++;

  const escalated = byTier.get("escalated")!;
  const routedLite = escalated.length + byTier.get("lite")!.length + byTier.get("lookup")!.length;
  const sensitive = rows.flatMap((row) => (row.routing?.sensitive ? [row.routing.sensitive] : []));

  return {
    answers: rows.length,
    tiers: ROUTE_TIERS.map((tier) => tierStats(tier, byTier.get(tier)!, again)),
    sensitive: { answers: sensitive.length, byTopic: count(sensitive) },
    escalation: {
      answers: escalated.length,
      rate: share(escalated.length, routedLite),
      byReason: count(escalated.flatMap((row) => (row.escalation ? [row.escalation] : []))),
    },
    falseSimple: {
      rate: share(candidates.length, kept.length),
      kept: kept.length,
      candidates: candidates.length,
      byReason,
      listed: candidates.slice(0, LISTED).map(({ row, reasons }) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        question: row.question,
        tier: tierOf(row) === "lookup" ? "lookup" : "lite",
        reasons,
      })),
    },
  };
}
