/**
 * Overview → Faithfulness (plan phase 26; `server/src/ask/faithfulness-routes.ts`):
 * what the judge found on visitors' answers, per model and per route. The
 * random sample the nightly judge draws is the fair view; "all judged" adds
 * the flagged answers it also judges and the reviewed ones calibration runs
 * judged, which lean toward bad answers. Shapes and pure helpers.
 */

export interface JudgedStats {
  judged: number;
  /** Means; null with none judged. Faithfulness 0–1, helpfulness 1–5. */
  faithfulness: number | null;
  helpfulness: number | null;
  /** Judged below the faithful line, 0.8. */
  below: number;
}

export interface FaithfulnessRow {
  key: string;
  sampled: JudgedStats;
  all: JudgedStats;
}

export interface NightlyRun {
  id: string;
  at: string;
  /** The UTC day it judged. */
  day: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
  judged: number;
  total: number;
  usd: number;
  error: string | null;
}

export interface FaithfulnessView {
  days: number;
  /** The judge that may read visitor answers now; null without one. */
  judge: string | null;
  /** Who judged the rows shown, most first: a chain fails over, and the judge may change. */
  judges: { model: string; judged: number }[];
  byModel: FaithfulnessRow[];
  byRoute: FaithfulnessRow[];
  nightly: NightlyRun | null;
}

/** "0.93, 1 of 12 below 0.8", or a dash with nothing judged. */
export function faithfulLine(stats: JudgedStats): string {
  if (!stats.judged || stats.faithfulness === null) return "–";
  return `${stats.faithfulness.toFixed(2)}, ${stats.below} of ${stats.judged} below 0.8`;
}

/** "4.5 of 5", or a dash. */
export function helpfulLine(stats: JudgedStats): string {
  return stats.helpfulness === null ? "–" : `${stats.helpfulness.toFixed(1)} of 5`;
}

const ROUTES: Record<string, string> = {
  lite: "Lite",
  "lite→deep": "Lite, moved up to deep",
  deep: "Deep",
  "answer-only": "Answer-only (no tools)",
};

export const routeLabel = (route: string): string => ROUTES[route] ?? route;

/** "judged by gemini-flash-lite (12) and gemini-flash (2)", and the judge now when it differs. */
export function judgesLine(view: Pick<FaithfulnessView, "judge" | "judges">): string {
  const now = view.judge ?? "none: no judge may read visitor answers";
  if (!view.judges.length) return `nothing judged yet (the judge now: ${now})`;
  const names = view.judges.map((j) => `${j.model} (${j.judged})`);
  const by = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const same = view.judges.length === 1 && view.judges[0]!.model === view.judge;
  return same ? `judged by ${by}` : `judged by ${by}; the judge now: ${now}`;
}

/** The last night in one sentence. */
export function nightlyLine(run: NightlyRun | null): string {
  if (!run) {
    return "The nightly judge has not run yet: it starts once switched on (Settings → Spending → Nightly judge).";
  }
  const of = run.day ? ` of ${run.day}` : "";
  const count = `${run.judged} of ${run.total} ${run.total === 1 ? "answer" : "answers"}${of}`;
  if (run.status === "done") return `The last night judged ${count} ($${run.usd.toFixed(4)}).`;
  if (run.status === "queued" || run.status === "running") return `Judging ${count} now.`;
  return `The last night stopped after ${count}: ${run.error ?? run.status}`;
}
