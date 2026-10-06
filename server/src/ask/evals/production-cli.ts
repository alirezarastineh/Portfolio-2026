import type { AskConfig } from "../config.js";
import { askVisitorJudges } from "../deps.js";
import { buildChain, type ChainRole, type ModelEntry } from "../models/registry.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { runProductionSuite } from "./production.js";
import { FREE_TIER_EVAL_PACING, FREE_TIER_RATE_LIMIT_RETRY, type CaseResult } from "./run.js";

/**
 * `pnpm ai:eval --suite production`: the eval cases frozen from visitor
 * answers, each against the corpus snapshot it was answered from. It reads the
 * cases and snapshots (through the tunnel, read-only) and writes nothing.
 * Report only: the fixture suite's baseline is the gate. Exits 2 when a case
 * could not be run.
 *
 * The questions came from visitors, so only a judge that already answers
 * visitors may read them (`askVisitorJudges`), whatever SERVER_AI_JUDGE_MODELS
 * lists first; with none, or `--no-judge`, the cases are graded without one.
 */

const MARK: Record<CaseResult["status"], string> = { passed: "✓", failed: "✗", unavailable: "!" };

/** The production suite's models: its judges are visitor judges only, or none. */
export function productionJudging(
  config: AskConfig,
  wanted: boolean,
): { judge: boolean; chain: (role: ChainRole) => ModelEntry[]; label: string } {
  const judges = askVisitorJudges(config);
  const judge = wanted && judges.length > 0;
  return {
    judge,
    chain: (role) => (role === "judge" ? judges : buildChain(config, role)),
    label: judge ? `judged by ${judges[0]!.id}` : "without a judge",
  };
}

export async function productionCli(
  config: AskConfig,
  options: { judge: boolean; deep?: boolean },
): Promise<number> {
  const { judge, chain, label } = productionJudging(config, options.judge);
  const on = options.deep ? ", on the deep chain" : "";
  console.log(`Running the production cases, each against its corpus snapshot${on}, ${label}.\n`);
  const { planned, results, missing } = await runProductionSuite({
    config,
    chain,
    concurrency: 1,
    judge,
    ...(options.deep ? { routing: { deep: true } } : {}),
    pacing: FREE_TIER_EVAL_PACING,
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    stopOnUnavailable: true,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    onResult: (r) => {
      const failures = r.passed ? "" : `\n    ${r.failures.join("\n    ")}`;
      console.log(`${MARK[r.status]} ${r.id}${failures}`);
    },
  });
  const completed = results.filter((r) => r.status !== "unavailable").length;
  const passed = results.filter((r) => r.passed).length;
  const missingSuffix = missing ? ` · ${missing} without their snapshot` : "";
  console.log(`\nPassed ${passed}/${completed} completed · ${planned} planned${missingSuffix}`);
  return completed < planned ? 2 : 0;
}
