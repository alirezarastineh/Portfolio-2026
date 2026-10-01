import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type { EvalCategorySummary, EvalSummary } from "./run.js";

/**
 * The eval gate. `baseline.json` records the last full run against the frozen
 * fixture corpus, and a later run must not fall below its pass rate or cost
 * much more per case (`compareToBaseline`). The prompt guard ties the record
 * to the prompt: `baseline.spec.ts` fails in CI when the instructions in
 * prompt.ts change without a new recorded run, unless `waivers` names the new
 * version with a reason. A run that fails the gate, or cannot be compared
 * with the recorded one, becomes the baseline only with a reason too
 * (`acceptedRegression`). Both are audited exceptions, reviewed like code.
 */

export const BASELINE_PATH = fileURLToPath(new URL("./baseline.json", import.meta.url));

const categorySchema = z.object({
  cases: z.number().int().min(0),
  completed: z.number().int().min(0),
  passed: z.number().int().min(0),
  unavailable: z.number().int().min(0),
});

// Every field has a default, so an older or partial file still reads.
const baselineSchema = z.object({
  /** `${PROMPT_VERSION}+${PROMPT_HASH}` of the recorded run. */
  promptVersion: z.string().nullable().default(null),
  corpus: z.string().nullable().default(null),
  cases: z.number().int().min(0).nullable().default(null),
  /** The judge's model: another judge scores differently, so runs compare only with the same one. */
  judge: z.string().nullable().default(null),
  passRate: z.number().min(0).max(1).nullable().default(null),
  byCategory: z.record(z.string(), categorySchema).default({}),
  usdPerCase: z.number().min(0).nullable().default(null),
  p50TtftMs: z.number().min(0).nullable().default(null),
  p95TotalMs: z.number().min(0).nullable().default(null),
  at: z.string().nullable().default(null),
  /** Why this run was recorded although it failed the gate against the one before. */
  acceptedRegression: z
    .object({ reason: z.string().trim().min(1), failures: z.array(z.string()) })
    .nullable()
    .default(null),
  /** Prompt versions allowed to ship without a recorded run, each with its reason. */
  waivers: z.record(z.string(), z.string().trim().min(1)).default({}),
});

export type Baseline = z.infer<typeof baselineSchema>;

/** The recorded baseline; a missing file reads as an empty one (no run, no waivers). */
export function readBaseline(path = BASELINE_PATH): Baseline {
  const raw: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const parsed = baselineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${path} is not a valid eval baseline:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function writeBaseline(baseline: Baseline, path = BASELINE_PATH): void {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

/** Whether the prompt in prompt.ts may ship: it has a recorded run, or a waiver. */
export function promptGuard(baseline: Baseline, version: string): { ok: boolean; message: string } {
  if (baseline.promptVersion === version && baseline.passRate !== null) {
    return { ok: true, message: `${version} has a recorded eval run (${baseline.at}).` };
  }
  const waiver = baseline.waivers[version];
  if (waiver) return { ok: true, message: `${version} is waived: ${waiver}` };
  return {
    ok: false,
    message:
      `The prompt is ${version}, but the eval baseline is for ${baseline.promptVersion ?? "no recorded run"}. ` +
      "Run `pnpm -C server ai:eval --update-baseline` (paid), or add a waiver for this version, " +
      "with its reason, to server/src/ask/evals/baseline.json.",
  };
}

function usdPerCase(summary: Pick<EvalSummary, "usd" | "completed">): number | null {
  return summary.completed ? Math.round((summary.usd / summary.completed) * 1e6) / 1e6 : null;
}

/**
 * The record of a complete, unfiltered fixture run. It clears every waiver:
 * they excuse versions that had no run, and this run supersedes them all.
 */
export function baselineFrom(
  summary: EvalSummary,
  options: { at?: Date; acceptedRegression?: Baseline["acceptedRegression"] } = {},
): Baseline {
  return {
    promptVersion: summary.promptVersion,
    corpus: summary.corpus,
    cases: summary.cases,
    judge: summary.judge,
    passRate: summary.passRate,
    byCategory: summary.byCategory,
    usdPerCase: usdPerCase(summary),
    p50TtftMs: summary.p50TtftMs,
    p95TotalMs: summary.p95TotalMs,
    at: (options.at ?? new Date()).toISOString(),
    acceptedRegression: options.acceptedRegression ?? null,
    waivers: {},
  };
}

/**
 * Why a run must not become the baseline, or null when it may. The baseline
 * is always a complete, judged fixture run. Replacing it needs a reason, which
 * the baseline then records, when the run fails the gate, and also when it
 * could not be compared at all (another judge, an edited fixture): otherwise
 * a worse run could slip in as the new bar unexamined.
 */
export function recordRefusal(
  summary: EvalSummary,
  run: {
    filtered: boolean;
    live: boolean;
    failures: string[];
    acceptReason: string | null;
    /** Why the run could not be compared with a recorded baseline, if it could not. */
    incomparable?: string | null;
  },
): string | null {
  if (summary.incomplete) return "Not updating the baseline from an incomplete run.";
  if (run.filtered) return "Not updating the baseline from a filtered run.";
  if (run.live) {
    return "Not updating the baseline from the live corpus: the gate compares fixture runs.";
  }
  if (!summary.judge) {
    return "Not updating the baseline from a run without the judge: its cases cannot fail on faithfulness or helpfulness.";
  }
  if (run.acceptReason?.trim()) return null;
  if (run.failures.length) {
    return 'Not updating the baseline from a run that fails the gate. To lower the bar on purpose, add --accept-regression "<why>": the reason is recorded with the baseline.';
  }
  if (run.incomparable) {
    return `Not replacing a baseline this run could not be compared with (${run.incomparable}) without a reason: add --accept-regression "<why>", which is recorded with the baseline.`;
  }
  return null;
}

/** A `--max-…-increase` value, a percentage such as "25", as a fraction. */
export function parsePercent(raw: string): number {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0) {
    throw new Error(`Not a percentage of at least 0: ${raw}`);
  }
  return value / 100;
}

export interface GateLimits {
  /** Allowed rise in cost per completed case, as a fraction: 0.25 is +25 %. */
  maxCostIncrease: number;
  /** Allowed rise in p95 total time; null reports latency without gating it. */
  maxLatencyIncrease: number | null;
}

/**
 * Latency is reported but not gated by default: eval runs are paced for the
 * free tier, and the waits fall inside each case's time to first token and
 * total time, so eval latency mostly measures the pacing.
 */
export const DEFAULT_GATE: GateLimits = { maxCostIncrease: 0.25, maxLatencyIncrease: null };

export interface Comparison {
  /** False when there is nothing to compare with: no recorded run, or another corpus. */
  compared: boolean;
  /** Why the run fails the gate; empty when it passes. */
  failures: string[];
  /** The report, one console line each. */
  lines: string[];
}

const percent = (fraction: number) => `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(1)} %`;
const rate = (row: EvalCategorySummary) => (row.completed ? row.passed / row.completed : 0);

/** The relative change from `before` to `now`, when both exist and `before` is positive. */
function rise(now: number | null, before: number | null): number | null {
  return now === null || before === null || before <= 0 ? null : (now - before) / before;
}

/** The categories whose pass rate moved, or one line saying none did. */
function categoryLines(
  now: Record<string, EvalCategorySummary>,
  before: Record<string, EvalCategorySummary>,
): string[] {
  const lines: string[] = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const was = before[name];
    const is = now[name];
    const label = `    ${name.padEnd(14)}`;
    if (!is) lines.push(`${label} not run (was ${was!.passed}/${was!.completed})`);
    else if (!was) lines.push(`${label} ${is.passed}/${is.completed} (new)`);
    else if (rate(is) !== rate(was)) {
      const mark = rate(is) < rate(was) ? "▼" : "▲";
      lines.push(`${label} ${was.passed}/${was.completed} → ${is.passed}/${is.completed} ${mark}`);
    }
  }
  return lines.length ? lines : ["    every category unchanged"];
}

/** Why a run cannot be compared with a recorded baseline at all, or null when it can. */
function incomparable(summary: EvalSummary, baseline: Baseline): string | null {
  if (baseline.corpus !== summary.corpus) {
    return `The baseline is for corpus ${baseline.corpus}, this run used ${summary.corpus}: not compared.`;
  }
  // Without the judge a case cannot fail on faithfulness, so its pass rate reads
  // higher; another judge scores by its own lights.
  if (baseline.judge !== summary.judge) {
    const judged = (model: string | null) => (model ? `judged by ${model}` : "not judged");
    return `The baseline was ${judged(baseline.judge)}, this run was ${judged(summary.judge)}: not compared.`;
  }
  return null;
}

/**
 * A run against the baseline, like for like (same corpus, same judge). The
 * pass rate is the floor; cost per case is the tie-breaker, compared only over
 * the same number of cases, and so is latency, which only fails the gate when
 * a limit is set.
 */
export function compareToBaseline(
  summary: EvalSummary,
  baseline: Baseline,
  limits: GateLimits = DEFAULT_GATE,
): Comparison {
  if (baseline.passRate === null) {
    return {
      compared: false,
      failures: [],
      lines: ["No recorded baseline yet: nothing to compare."],
    };
  }
  const reason = incomparable(summary, baseline);
  if (reason) return { compared: false, failures: [], lines: [reason] };

  const failures: string[] = [];
  const lines = [
    `Baseline ${baseline.promptVersion} (${baseline.at?.slice(0, 10)}, ${baseline.cases} cases, judged by ${baseline.judge}):`,
  ];

  const delta = summary.passRate - baseline.passRate;
  const points = `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts`;
  lines.push(
    `  pass rate      ${(baseline.passRate * 100).toFixed(1)} % → ${(summary.passRate * 100).toFixed(1)} % (${points})`,
  );
  if (delta < 0) failures.push(`the pass rate fell ${(-delta * 100).toFixed(1)} pts`);
  lines.push(...categoryLines(summary.byCategory, baseline.byCategory));

  if (baseline.cases !== summary.cases) {
    lines.push(`  cost, latency  not compared: this run had ${summary.cases} cases`);
    return { compared: true, failures, lines };
  }

  const cost = usdPerCase(summary);
  const costRise = rise(cost, baseline.usdPerCase);
  const costLimit = `limit ${percent(limits.maxCostIncrease)}`;
  lines.push(
    `  cost per case  $${baseline.usdPerCase?.toFixed(4)} → $${cost?.toFixed(4)}` +
      (costRise === null ? "" : ` (${percent(costRise)}, ${costLimit})`),
  );
  if (costRise !== null && costRise > limits.maxCostIncrease) {
    failures.push(`cost per case rose ${percent(costRise)} (${costLimit})`);
  }

  const ttftRise = rise(summary.p50TtftMs, baseline.p50TtftMs);
  lines.push(
    `  p50 TTFT       ${baseline.p50TtftMs ?? "–"} ms → ${summary.p50TtftMs ?? "–"} ms` +
      (ttftRise === null ? "" : ` (${percent(ttftRise)})`),
  );
  const totalRise = rise(summary.p95TotalMs, baseline.p95TotalMs);
  const latencyLimit =
    limits.maxLatencyIncrease === null
      ? "not gated"
      : `limit ${percent(limits.maxLatencyIncrease)}`;
  lines.push(
    `  p95 total      ${baseline.p95TotalMs ?? "–"} ms → ${summary.p95TotalMs ?? "–"} ms` +
      (totalRise === null ? "" : ` (${percent(totalRise)}, ${latencyLimit})`),
  );
  if (
    totalRise !== null &&
    limits.maxLatencyIncrease !== null &&
    totalRise > limits.maxLatencyIncrease
  ) {
    failures.push(`p95 total time rose ${percent(totalRise)} (${latencyLimit})`);
  }

  return { compared: true, failures, lines };
}
