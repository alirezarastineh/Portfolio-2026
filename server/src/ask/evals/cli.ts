import { loadEnvFiles } from "../../lib/env.js";
import { getAskConfig } from "../config.js";
import { getAskCorpus } from "../corpus/index.js";
import { buildChain } from "../models/registry.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { loadEncoder } from "../tokens.js";
import { hasFlag, optionValues } from "./args.js";
import {
  BASELINE_PATH,
  baselineFrom,
  compareToBaseline,
  DEFAULT_GATE,
  parsePercent,
  readBaseline,
  recordRefusal,
  writeBaseline,
  type GateLimits,
} from "./baseline.js";
import { EVAL_CASES } from "./cases.js";
import { fixtureAskCorpus } from "./fixture.js";
import { pairwiseCli, pairwiseSides } from "./pairwise-cli.js";
import { productionCli } from "./production-cli.js";
import { FREE_TIER_EVAL_PACING, FREE_TIER_RATE_LIMIT_RETRY, runEvals } from "./run.js";

/**
 * `pnpm ai:eval` — runs the eval suite live against the configured models.
 * It consumes provider quota, so it is run by hand, never in CI.
 *
 *   --case <id|category>          only matching cases (repeatable)
 *   --corpus live                 the published corpus instead of the frozen fixture
 *   --no-judge                    skip the LLM judge
 *   --concurrency <n>             parallel questions (default 1; provider calls stay paced)
 *   --max-cost-increase <pct>     allowed rise in cost per case (default 25)
 *   --max-latency-increase <pct>  also gate the p95 total time (off by default: the
 *                                 free-tier pacing waits count as latency here)
 *   --update-baseline             store this run as the baseline to beat
 *   --accept-regression "<why>"   with --update-baseline: record a run that fails
 *                                 the gate, or cannot be compared with the
 *                                 recorded one; the reason is stored with it
 *   --pairwise <A>,<B>            rank two answerers instead of grading one: each
 *                                 a route (lite, deep) or a model id; the judge
 *                                 sees both answers twice, swapped (pairwise-cli.ts)
 *   --candidate-prompt <file>     rank the current prompt (A) against this one (B),
 *                                 on the lite model unless --pairwise names the sides
 *   --suite production            the cases frozen from visitor answers, each against
 *                                 its own corpus snapshot (reads the database through
 *                                 the tunnel, writes nothing; report only)
 *
 * Exits 1 when the run fails the gate against baseline.json (a lower pass
 * rate, or a cost or latency rise above its limit) and is not recorded, 2
 * when the run is incomplete or cannot be recorded.
 */

const flag = (name: string) => hasFlag(process.argv, name);
const values = (name: string) => optionValues(process.argv, name);

/** A percentage flag as a fraction, or `fallback` when it is absent. */
function percentFlag(name: string, fallback: number | null): number | null {
  const [raw] = values(name);
  if (raw === undefined) return fallback;
  try {
    return parsePercent(raw);
  } catch {
    console.error(`--${name} takes a percentage of at least 0, such as 25.`);
    process.exit(2);
  }
}

const limits: GateLimits = {
  maxCostIncrease: percentFlag("max-cost-increase", DEFAULT_GATE.maxCostIncrease)!,
  maxLatencyIncrease: percentFlag("max-latency-increase", DEFAULT_GATE.maxLatencyIncrease),
};

loadEnvFiles();
const config = getAskConfig();
if (config.unavailableReason) {
  console.error(`The assistant cannot run: ${config.unavailableReason}`);
  process.exit(2);
}
await loadEncoder();

const live = values("corpus")[0] === "live";
const corpus = live ? await getAskCorpus(config) : fixtureAskCorpus(config);
const filters = values("case");
const cases = EVAL_CASES.filter(
  (c) =>
    (!live || !c.fixtureOnly) &&
    (!filters.length || filters.some((f) => c.id === f || c.category === f || c.id.startsWith(f))),
);

if (values("suite")[0] === "production") {
  // The frozen visitor cases, each against its own snapshot (read-only).
  process.exit(await productionCli(config, { judge: !flag("no-judge") }));
}

const pairwise = values("pairwise")[0];
const candidatePrompt = values("candidate-prompt")[0];
if (pairwise || candidatePrompt) {
  const planned = pairwiseSides(config, pairwise, candidatePrompt);
  if ("error" in planned) {
    console.error(planned.error);
    process.exit(2);
  }
  process.exit(await pairwiseCli({ config, corpus, cases, sides: planned.sides }));
}

const judge = flag("no-judge") ? "no judge" : `judged by ${buildChain(config, "judge")[0]?.id}`;
console.log(
  `Running ${cases.length} case(s) against ${live ? "the live" : "the fixture"} corpus with ${config.gemini.model}, ${judge}. Free-tier-safe pacing is enabled.\n`,
);

function resultMark(status: string, passed: boolean): string {
  if (status === "unavailable") return "!";
  return passed ? "✓" : "✗";
}

const summary = await runEvals({
  cases,
  corpus,
  config,
  chain: (role) => buildChain(config, role),
  concurrency: Number(values("concurrency")[0] ?? 1),
  pacing: FREE_TIER_EVAL_PACING,
  rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
  stopOnUnavailable: true,
  judge: !flag("no-judge"),
  promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
  onResult: (r) => {
    const mark = resultMark(r.status, r.passed);
    const meta = `${r.model ?? "no model"} · ${(r.totalMs / 1000).toFixed(1)} s`;
    const failures = r.passed ? "" : `\n    ${r.failures.join("\n    ")}`;
    console.log(`${mark} ${r.id.padEnd(22)} ${meta}${failures}`);
  },
});

console.log("\nBy category:");
for (const [category, row] of Object.entries(summary.byCategory)) {
  const pending = row.cases - row.completed - row.unavailable;
  const incomplete =
    row.unavailable || pending ? ` · ${row.unavailable} unavailable, ${pending} pending` : "";
  console.log(`  ${category.padEnd(14)} ${row.passed}/${row.completed}${incomplete}`);
}
console.log(
  `\nPassed ${summary.passed}/${summary.completed} completed (${(summary.passRate * 100).toFixed(1)} %) · ${summary.cases} planned · $${summary.usd.toFixed(4)} estimated · p50 TTFT ${summary.p50TtftMs ?? "–"} ms · p95 total ${summary.p95TotalMs ?? "–"} ms\n`,
);

let exitCode = 0;
let failures: string[] = [];
/** Why this run could not be compared with a recorded baseline, if it could not. */
let incomparable: string | null = null;
if (summary.incomplete) {
  console.error(
    `Incomplete run: ${summary.unavailable} unavailable, ${summary.remaining} not started. No baseline comparison or update is valid.`,
  );
  exitCode = 2;
} else if (!filters.length) {
  const baseline = readBaseline();
  const comparison = compareToBaseline(summary, baseline, limits);
  for (const line of comparison.lines) console.log(line);
  failures = comparison.failures;
  if (!comparison.compared && baseline.passRate !== null) incomparable = comparison.lines[0]!;
  if (failures.length) {
    console.error(
      `\nBelow the baseline: ${failures.join("; ")}. This change must not ship as it is.`,
    );
    exitCode = 1;
  }
}

if (flag("update-baseline")) {
  const acceptReason = values("accept-regression")[0]?.trim() || null;
  const refusal = recordRefusal(summary, {
    filtered: filters.length > 0,
    live,
    failures,
    acceptReason,
    incomparable,
  });
  if (refusal) {
    console.error(refusal);
    exitCode = 2;
  } else {
    // What the reason excuses: the gate's failures, or that no comparison was possible.
    const excused = failures.length || !incomparable ? failures : [incomparable];
    const acceptedRegression = excused.length ? { reason: acceptReason!, failures: excused } : null;
    writeBaseline(baselineFrom(summary, { acceptedRegression }));
    const accepted = acceptedRegression ? ", with the regression accepted" : "";
    console.log(`\nBaseline updated${accepted}: ${BASELINE_PATH}`);
    exitCode = 0;
  }
}

process.exit(exitCode);
