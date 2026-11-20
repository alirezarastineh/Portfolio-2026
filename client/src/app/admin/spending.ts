import type {
  AssistantSettings,
  AssistantSettingsInput,
  AssistantUsage,
  FencedFeature,
  SpendFeature,
  SpendToday,
  SwitchedFeature,
} from "./assistant-types";

/**
 * The spending fences in the admin (plan phase 13): what each feature spends,
 * the share of the daily budget kept for visitors, each feature's cap and
 * switch. Pure, so the Settings form and the Overview share it.
 */

/** A feature's name in the admin. One that is not built yet has none and shows only once it spends. */
const LABELS: Partial<Record<SpendFeature, string>> = {
  terminal: "Visitors' assistant",
  match: "Match a brief",
  playground: "Playground",
  copilot: "Copilot",
  insights: "Insights",
  autoInsights: "Automatic insights",
  eval: "Eval runs",
  pairwise: "Pairwise runs",
  judge: "Judge runs",
  nightlyJudge: "Nightly judge",
  embeddings: "Search by meaning",
  agent: "Admin agents",
};

export const featureLabel = (feature: string): string => LABELS[feature as SpendFeature] ?? feature;

/** The features the Settings form offers a cap for, in this order. */
export const CAPPED: FencedFeature[] = [
  "match",
  "playground",
  "copilot",
  "insights",
  "autoInsights",
  "eval",
  "pairwise",
  "judge",
  "nightlyJudge",
  "embeddings",
  "agent",
];

/** The features the Settings form offers a switch for (their words: `assistant-settings.ts`). */
export const SWITCHED: readonly SwitchedFeature[] = [
  "match",
  "copilot",
  "judge",
  "nightlyJudge",
  "embeddings",
  "autoInsights",
  "agent",
];

export type FeatureState = SpendToday["features"][number]["state"];

const STATE_LABELS: Record<FeatureState, string> = {
  ok: "spending",
  off: "switched off",
  budget: "budget spent",
  reserve: "stopped at the reserve line",
  cap: "stopped at its cap",
};

export const stateLabel = (state: FeatureState): string => STATE_LABELS[state];

/**
 * Why `feature`'s next call would be refused, in words ("Eval runs: stopped at its cap."), or null
 * while it may spend. Unknown (no health yet, an older API, a feature it does not list) is null:
 * the button stays and the server decides. Its paid buttons turn off with these words (plan 5, U18).
 */
export function featureStop(spend: SpendToday | undefined, feature: SpendFeature): string | null {
  const state = spend?.features.find((f) => f.feature === feature);
  if (!state || state.state === "ok") {
    return null;
  }
  // Off without its own switch off: the deploy turned the assistant off (`guard.ts` `offReason`).
  const words =
    state.state === "off" && state.switchedOn !== false
      ? "the assistant is off on this server"
      : stateLabel(state.state);
  return `${featureLabel(feature)}: ${words}.`;
}

export interface FeatureRow {
  feature: string;
  label: string;
  /** Today's spend (UTC). */
  todayUsd: number;
  /** The usage period's spend. */
  periodUsd: number;
  capUsd: number | null;
  /** Null when the health came from an API without the fences. */
  state: FeatureState | null;
}

/**
 * One row per feature that is built or has spent anything: today's spend and
 * state from the health, the period's spend from the usage. Most spent first.
 */
export function featureRows(
  spend: SpendToday | undefined,
  usage: Pick<AssistantUsage, "features"> | null,
): FeatureRow[] {
  const period = new Map<string, number>();
  for (const row of usage?.features ?? []) {
    period.set(row.feature, (period.get(row.feature) ?? 0) + row.usd);
  }
  const today = new Map((spend?.features ?? []).map((f) => [f.feature as string, f]));
  const names = new Set<string>([
    ...Object.keys(LABELS),
    ...period.keys(),
    ...(spend?.features ?? []).filter((f) => f.spentUsd > 0).map((f) => f.feature),
  ]);
  return [...names]
    .map((feature) => {
      const now = today.get(feature);
      return {
        feature,
        label: featureLabel(feature),
        todayUsd: now?.spentUsd ?? 0,
        periodUsd: period.get(feature) ?? 0,
        capUsd: now?.capUsd ?? null,
        state: now?.state ?? null,
      };
    })
    .sort((a, b) => b.todayUsd - a.todayUsd || b.periodUsd - a.periodUsd);
}

/** The fences as the Settings form edits them: text as typed, switches as they are. */
export interface SpendDraft {
  /** The visitors' reserve in percent. */
  reserve: string;
  caps: Record<string, string>;
  switches: Record<string, boolean>;
}

export function spendDraft(settings: AssistantSettings): SpendDraft {
  return {
    reserve: String(Math.round((settings.publicReserve ?? 0.5) * 100)),
    caps: Object.fromEntries(
      CAPPED.map((f) => {
        const cap = settings.featureCaps?.[f] ?? null;
        return [f, cap === null ? "" : String(cap)];
      }),
    ),
    switches: Object.fromEntries(
      SWITCHED.map((feature) => [feature, settings.featureSwitches?.[feature] ?? true]),
    ),
  };
}

type SpendInput = Pick<AssistantSettingsInput, "publicReserve" | "featureCaps" | "featureSwitches">;

/** The draft as a save, or the reason it cannot be saved. Only the features the form shows are sent. */
export function spendInput(
  draft: SpendDraft,
): { ok: true; value: SpendInput } | { ok: false; error: string } {
  const reserve = draft.reserve.trim() === "" ? Number.NaN : Number(draft.reserve);
  if (!(reserve >= 0 && reserve <= 90)) {
    return { ok: false, error: "The share kept for visitors must be between 0 and 90 %" };
  }
  const featureCaps: Partial<Record<FencedFeature, number | null>> = {};
  for (const feature of CAPPED) {
    const text = (draft.caps[feature] ?? "").trim();
    const cap = text === "" ? null : Number(text);
    if (cap !== null && !(cap >= 0.01 && cap <= 100)) {
      return {
        ok: false,
        error: `The cap for ${featureLabel(feature)} must be between 0.01 and 100 USD, or empty`,
      };
    }
    featureCaps[feature] = cap;
  }
  const featureSwitches: Partial<Record<SwitchedFeature, boolean>> = {};
  for (const feature of SWITCHED) {
    featureSwitches[feature] = draft.switches[feature] ?? true;
  }
  return {
    ok: true,
    value: { publicReserve: reserve / 100, featureCaps, featureSwitches },
  };
}
