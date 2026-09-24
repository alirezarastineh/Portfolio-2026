import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnvFiles } from "../../lib/env.js";
import { getAskConfig } from "../config.js";
import { getAskCorpus } from "../corpus/index.js";
import { buildChain } from "../models/registry.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { loadEncoder } from "../tokens.js";
import { EVAL_CASES } from "./cases.js";
import { fixtureAskCorpus } from "./fixture.js";
import { runEvals, type EvalSummary } from "./run.js";

/**
 * `pnpm ai:eval` — runs the eval suite live against the configured models.
 * It spends money (a few cents a run), so it is run by hand, never in CI.
 *
 *   --case <id|category>   only matching cases (repeatable)
 *   --corpus live          the published corpus instead of the frozen fixture
 *   --no-judge             skip the LLM judge
 *   --concurrency <n>      parallel questions (default 3; 1 on a free tier)
 *   --update-baseline      store this run as the baseline to beat
 *
 * Exits 1 when the pass rate falls below the baseline.
 */

const BASELINE = fileURLToPath(new URL("./baseline.json", import.meta.url));

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function values(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((arg, i) => {
    if (arg === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

interface Baseline {
  promptVersion: string;
  corpus: string;
  passRate: number;
  byCategory: EvalSummary["byCategory"];
  at: string;
}

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

console.log(
  `Running ${cases.length} case(s) against ${live ? "the live" : "the fixture"} corpus with ${config.gemini.model}. This calls paid models.\n`,
);

const summary = await runEvals({
  cases,
  corpus,
  config,
  chain: (role) => buildChain(config, role),
  concurrency: Number(values("concurrency")[0] ?? 3),
  judge: !flag("no-judge"),
  promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
  onResult: (r) => {
    const mark = r.passed ? "✓" : "✗";
    const meta = `${r.model ?? "no model"} · ${(r.totalMs / 1000).toFixed(1)} s`;
    const failures = r.passed ? "" : `\n    ${r.failures.join("\n    ")}`;
    console.log(`${mark} ${r.id.padEnd(22)} ${meta}${failures}`);
  },
});

console.log("\nBy category:");
for (const [category, row] of Object.entries(summary.byCategory)) {
  console.log(`  ${category.padEnd(14)} ${row.passed}/${row.cases}`);
}
console.log(
  `\nPassed ${summary.passed}/${summary.cases} (${(summary.passRate * 100).toFixed(1)} %) · $${summary.usd.toFixed(4)} · p50 TTFT ${summary.p50TtftMs ?? "–"} ms · p95 total ${summary.p95TotalMs ?? "–"} ms`,
);

let exitCode = 0;
const baseline = existsSync(BASELINE)
  ? (JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline)
  : null;
if (baseline && !filters.length && baseline.corpus === summary.corpus) {
  const delta = summary.passRate - baseline.passRate;
  console.log(
    `Baseline ${(baseline.passRate * 100).toFixed(1)} % (${baseline.promptVersion}, ${baseline.at.slice(0, 10)}): ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts`,
  );
  if (delta < 0) {
    console.error("Below the baseline: this change must not ship as it is.");
    exitCode = 1;
  }
}

if (flag("update-baseline")) {
  if (filters.length) {
    console.error("Not updating the baseline from a filtered run.");
    exitCode = 2;
  } else {
    const next: Baseline = {
      promptVersion: summary.promptVersion,
      corpus: summary.corpus,
      passRate: summary.passRate,
      byCategory: summary.byCategory,
      at: new Date().toISOString(),
    };
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Baseline updated: ${BASELINE}`);
  }
}

process.exit(exitCode);
