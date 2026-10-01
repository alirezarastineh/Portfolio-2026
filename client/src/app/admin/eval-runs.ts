import type { EvalCaseResult, RunItem, RunRow } from "./assistant-types";

/**
 * How the Evals tab reads background runs: whether one is still going, how far
 * it got, whether it can be resumed, and what changed between two runs. Pure,
 * so the component stays thin.
 */

export function isActive(run: Pick<RunRow, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

/** A stopped run with items still to do. */
export function canResume(run: Pick<RunRow, "status" | "progress">): boolean {
  if (!["interrupted", "failed", "cancelled"].includes(run.status)) return false;
  const { total, done } = run.progress;
  return done < total;
}

/** Items finished (graded, failed or not) out of all, as a share for the bar. */
export function progressShare(run: Pick<RunRow, "progress">): number {
  const { total, done } = run.progress;
  return total ? Math.min(1, done / total) : 0;
}

export function passCounts(items: readonly RunItem[]): { passed: number; graded: number } {
  let passed = 0;
  let graded = 0;
  for (const item of items) {
    if (item.status !== "done" || !item.result) continue;
    graded++;
    if (item.result.passed) passed++;
  }
  return { passed, graded };
}

export type CaseVerdict = "passed" | "failed" | "not run";

export interface ComparisonRow {
  id: string;
  a: CaseVerdict;
  b: CaseVerdict;
  /** Passed in one run and failed in the other. */
  changed: boolean;
}

function verdict(result: EvalCaseResult | null | undefined): CaseVerdict {
  if (!result || result.status === "unavailable") return "not run";
  return result.passed ? "passed" : "failed";
}

/** Case by case, every case either run graded; the flips first. */
export function compareRuns(a: readonly RunItem[], b: readonly RunItem[]): ComparisonRow[] {
  const inA = new Map(a.map((item) => [item.key, item.result]));
  const inB = new Map(b.map((item) => [item.key, item.result]));
  const ids = [...new Set([...inA.keys(), ...inB.keys()])];
  return ids
    .map((id) => {
      const va = verdict(inA.get(id));
      const vb = verdict(inB.get(id));
      return { id, a: va, b: vb, changed: va !== vb && va !== "not run" && vb !== "not run" };
    })
    .sort((x, y) => Number(y.changed) - Number(x.changed));
}
