import { readFileSync } from "node:fs";

import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import { buildChain, variantChain } from "../models/registry.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import type { EvalCase } from "./cases.js";
import type { PairOutcome, PairwiseCaseResult } from "./pairwise.js";
import { runPairwise, type PairwiseVariant } from "./pairwise-run.js";
import { FREE_TIER_EVAL_PACING, FREE_TIER_RATE_LIMIT_RETRY } from "./run.js";

/**
 * `pnpm ai:eval --pairwise <A>,<B>` and `--candidate-prompt <file>`: two
 * answerers compared case by case (pairwise.ts). Ranking only: nothing is
 * gated and the baseline is never touched. Exits 2 when a case could not be
 * answered or judged.
 */

const MARK: Record<PairOutcome, string> = { a: "A", b: "B", tie: "=", inconsistent: "≠" };

type Sides = [PairwiseVariant, PairwiseVariant];

/**
 * The two sides from `--pairwise` and `--candidate-prompt`, or why they
 * cannot be had. A prompt comparison defaults to the main model on both
 * sides, so only the prompt differs.
 */
export function pairwiseSides(
  config: AskConfig,
  pairwise: string | undefined,
  candidatePrompt: string | undefined,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): { sides: Sides } | { error: string } {
  const names = pairwise?.split(",").map((s) => s.trim()) ?? [];
  if (pairwise && (names.length !== 2 || names.some((n) => !n))) {
    return { error: "--pairwise takes two answerers, such as lite,deep or two model ids." };
  }
  const [a, b] = names.length === 2 ? names : [config.gemini.model, config.gemini.model];
  if (a === b && !candidatePrompt) {
    return { error: `Both sides are "${a}": name two answerers, or add --candidate-prompt.` };
  }
  const chains = [variantChain(config, a!), variantChain(config, b!)];
  const missing = [a, b].find((_, i) => !chains[i]?.length);
  if (missing) {
    return {
      error: `No model for "${missing}": name a route (lite, deep) or a model whose key is set.`,
    };
  }
  if (!candidatePrompt) {
    return {
      sides: [
        { label: a!, chain: chains[0]! },
        { label: b!, chain: chains[1]! },
      ],
    };
  }
  return {
    sides: [
      { label: `${a} · current prompt`, chain: chains[0]! },
      {
        label: `${b} · ${candidatePrompt}`,
        chain: chains[1]!,
        systemPrompt: read(candidatePrompt),
      },
    ],
  };
}

function line(r: PairwiseCaseResult): string {
  const pass = (failures: string[]) => (failures.length ? "✗" : "✓");
  const outcome = r.outcome ? MARK[r.outcome] : "!";
  const why = r.status === "unavailable" ? ` (${r.reasons.join("; ")})` : "";
  return `${outcome} ${r.id.padEnd(22)} A ${pass(r.a.failures)} B ${pass(r.b.failures)}${why}`;
}

export async function pairwiseCli(input: {
  config: AskConfig;
  corpus: AskCorpus;
  cases: EvalCase[];
  sides: Sides;
}): Promise<number> {
  const { config, corpus, cases, sides } = input;
  const judgeChain = buildChain(config, "judge");
  console.log(
    `Comparing A = ${sides[0].label} with B = ${sides[1].label} on ${cases.length} case(s), judged by ${judgeChain[0]?.id ?? "no judge"} in both orders. Free-tier-safe pacing is enabled.\n`,
  );
  const summary = await runPairwise({
    cases,
    corpus,
    config,
    a: sides[0],
    b: sides[1],
    judgeChain,
    pacing: FREE_TIER_EVAL_PACING,
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    onResult: (r) => console.log(line(r)),
  });

  console.log("\nBy category (A / B / tie / inconsistent):");
  for (const [category, t] of Object.entries(summary.byCategory)) {
    console.log(`  ${category.padEnd(14)} ${t.a} / ${t.b} / ${t.tie} / ${t.inconsistent}`);
  }
  const agreement =
    summary.swapAgreement === null ? "–" : `${(summary.swapAgreement * 100).toFixed(1)} %`;
  console.log(
    `\nJudged ${summary.judged} of ${summary.cases} · A ${summary.tally.a}, B ${summary.tally.b}, tie ${summary.tally.tie}, inconsistent ${summary.tally.inconsistent} · swap agreement ${agreement} · graders passed A ${summary.passed.a}, B ${summary.passed.b} · $${summary.usd.toFixed(4)} estimated\n`,
  );
  if (summary.judged < summary.cases) {
    console.error(
      `Incomplete: ${summary.unavailable} unavailable, ${summary.cases - summary.judged - summary.unavailable} not started.`,
    );
    return 2;
  }
  return 0;
}
