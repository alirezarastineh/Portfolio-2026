import type { EvalCaseResult, EvalConversation, RunItem, RunRow } from "./assistant-types";

/**
 * How the Evals tab reads background runs: whether one is still going, how far
 * it got, whether it can be resumed, and what changed between two runs. Pure,
 * so the component stays thin.
 */

/**
 * The eval suite's size: every case a run takes when it names none (`EVAL_CASES`,
 * `server/src/ask/evals/cases.ts`). The API says it only once a run exists, so the paid runs'
 * questions carry it from here; `eval-runs.spec.ts` counts the server's cases against it.
 */
export const EVAL_SUITE_CASES = 100;

const STATUS_WORDS: Record<RunRow["status"], string> = {
  queued: "waiting to start",
  running: "running",
  done: "finished",
  failed: "stopped",
  cancelled: "cancelled",
  interrupted: "interrupted by a restart",
};

/** A run's state in words: "finished", "stopped", "interrupted by a restart". */
export function statusWord(run: Pick<RunRow, "status">): string {
  return STATUS_WORDS[run.status];
}

const RESULT_WORDS: Record<EvalCaseResult["status"], string> = {
  passed: "Passed",
  failed: "Failed",
  unavailable: "Unavailable",
};

/** A graded case in a word: it passed, it failed, or no model answered it. */
export function resultWord(result: Pick<EvalCaseResult, "status">): string {
  return RESULT_WORDS[result.status];
}

/** Milliseconds as seconds with one decimal: "3.0 s". */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** The judge's scores, faithfulness (0 to 1) then helpfulness (1 to 5), or a dash unjudged. */
export function judgeScores(judge: EvalCaseResult["judge"]): string {
  return judge ? `${judge.faithfulness.toFixed(2)}, ${judge.helpfulness}` : "–";
}

/** "fact 18 of 18, german 8 of 9": each category's passed cases of those graded. */
export function categoryLine(
  byCategory: Readonly<Record<string, { completed: number; passed: number }>>,
): string {
  return Object.entries(byCategory)
    .map(([name, c]) => `${name} ${c.passed} of ${c.completed}`)
    .join(", ");
}

/** "Prompt ask-2026-11-02.1, judged by gemini-flash-lite (calibrated)." */
export function judgedLine(
  summary: { promptVersion: string; judge: string | null },
  mark: string | null,
): string {
  const how = mark ? ` (${mark})` : "";
  return `Prompt ${summary.promptVersion}, judged by ${summary.judge ?? "no judge"}${how}.`;
}

export function isActive(run: Pick<RunRow, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

/** A stopped run with items still to do. */
export function canResume(run: Pick<RunRow, "status" | "progress">): boolean {
  if (!["interrupted", "failed", "cancelled"].includes(run.status)) {
    return false;
  }
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
    if (item.status !== "done" || !item.result) {
      continue;
    }
    graded++;
    if (item.result.passed) {
      passed++;
    }
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
  if (!result || result.status === "unavailable") {
    return "not run";
  }
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

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A conversation case's earlier turns in a line (visitor plan V3): how many,
 * how many were answered live, and what the history did with them.
 */
export function conversationLine(c: EvalConversation): string {
  const parts = [`after ${countLabel(c.turns.length, "earlier turn", "earlier turns")}`];
  const live = c.turns.filter((t) => t.live).length;
  if (live) {
    parts.push(`${live} answered live`);
  }
  if (c.droppedAnswers === null) {
    parts.push("stopped at a live turn");
  } else if (c.droppedAnswers) {
    parts.push(`${countLabel(c.droppedAnswers, "answer", "answers")} refused`);
  }
  if (c.windowDropped) {
    parts.push(`${countLabel(c.windowDropped, "question", "questions")} past the window`);
  }
  return parts.join(", ");
}
