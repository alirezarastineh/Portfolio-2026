import { FAITHFUL_AT, type NightlyPick } from "./evals/calibration.js";

/**
 * Judged faithfulness on visitors' answers, per model and per route (plan
 * phase 26): what the nightly sampled judge, and the calibration runs before
 * it, found. Each row twice: the random sample alone (`pick: "sample"`), the
 * unbiased view, and every judged answer, flagged ones and reviewed ones
 * included (they lean toward bad answers). Pure: the route loads the rows.
 */

export interface JudgedRow {
  model: string | null;
  route: string;
  /** 0–1: the share of claims the cited documents support. */
  faithfulness: number;
  /** 1–5. */
  helpfulness: number;
  pick: NightlyPick | null;
}

export interface JudgedStats {
  judged: number;
  /** Means; null with none judged. */
  faithfulness: number | null;
  helpfulness: number | null;
  /** Judged below the faithful line (0.8). */
  below: number;
}

export interface FaithfulnessRow {
  key: string;
  sampled: JudgedStats;
  all: JudgedStats;
}

function stats(rows: readonly JudgedRow[]): JudgedStats {
  if (!rows.length) return { judged: 0, faithfulness: null, helpfulness: null, below: 0 };
  const mean = (pick: (r: JudgedRow) => number) =>
    rows.reduce((sum, r) => sum + pick(r), 0) / rows.length;
  return {
    judged: rows.length,
    faithfulness: mean((r) => r.faithfulness),
    helpfulness: mean((r) => r.helpfulness),
    below: rows.filter((r) => r.faithfulness < FAITHFUL_AT).length,
  };
}

/** One row per key (a model, a route), most judged first. */
export function faithfulnessBy(
  rows: readonly JudgedRow[],
  keyOf: (row: JudgedRow) => string,
): FaithfulnessRow[] {
  const groups = new Map<string, JudgedRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .map(([key, group]) => ({
      key,
      sampled: stats(group.filter((r) => r.pick === "sample")),
      all: stats(group),
    }))
    .sort((a, b) => b.all.judged - a.all.judged || a.key.localeCompare(b.key));
}
