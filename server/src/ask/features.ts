/**
 * What spends model money, feature by feature (plan phase 13). Every model
 * call is recorded under one feature (usage.ts), and every feature but the
 * visitors' terminal is fenced (guard.ts): it stops once the day's spend
 * reaches the line that keeps a share of the budget for visitors, once its
 * own cap is reached, or when the admin switches it off. With any reserve
 * above zero, an eval run, the copilot or insights can no longer put visitors
 * into "resting"; at zero they may spend the whole budget, as before.
 */

export const FEATURES = [
  "terminal",
  "playground",
  "copilot",
  "insights",
  "eval",
  "pairwise",
  "judge",
  // Reserved for the phases that build them (25, 29, 18): fenced from the start.
  "autoInsights",
  "agent",
  "embeddings",
] as const;
export type Feature = (typeof FEATURES)[number];

/** Everything but the terminal: the admin's tools and the background work. */
export type FencedFeature = Exclude<Feature, "terminal">;
export const FENCED_FEATURES = FEATURES.filter((f): f is FencedFeature => f !== "terminal");

/**
 * The features the admin can switch off, and whether each is on until they
 * do. Work that would spend on its own, or is not built yet, starts off.
 */
export const SWITCH_DEFAULTS = {
  copilot: true,
  judge: true,
  autoInsights: false,
  agent: false,
  embeddings: false,
} as const satisfies Partial<Record<FencedFeature, boolean>>;
export type SwitchedFeature = keyof typeof SWITCH_DEFAULTS;
export const SWITCHED_FEATURES = Object.keys(SWITCH_DEFAULTS) as SwitchedFeature[];

export function isSwitched(feature: Feature): feature is SwitchedFeature {
  return Object.hasOwn(SWITCH_DEFAULTS, feature);
}

/** The share of the daily budget kept for visitors unless the admin sets another. */
export const DEFAULT_PUBLIC_RESERVE = 0.5;
/** At most this much is kept, so the admin's tools always have a tenth of the budget. */
export const MAX_PUBLIC_RESERVE = 0.9;

/** The day's total spend at which fenced features stop: the budget less the visitors' reserve. */
export function reserveLine(budgetUsd: number, publicReserve: number): number {
  return budgetUsd * (1 - publicReserve);
}
