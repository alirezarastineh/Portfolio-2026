import { askChain, askConfig, askEvalPacing, askVariantChain } from "../deps.js";
import { embedInMemory } from "../embeddings.js";
import { EVAL_CASES } from "../evals/cases.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import { summarizePairwise, type PairwiseCaseResult } from "../evals/pairwise.js";
import { runPairwise } from "../evals/pairwise-run.js";
import { FREE_TIER_RATE_LIMIT_RETRY } from "../evals/run.js";
import type { ModelCall } from "../models/fallback.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { paidItems, PROVIDER_DOWN } from "./paid.js";
import type { WorkFn } from "./runner.js";
import { getRun } from "./store.js";

export interface PairwiseParams {
  a: string;
  b: string;
  cases: string[] | null;
}

/**
 * A pairwise run in the background (evals/pairwise-run.ts): two answerers
 * over the eval cases, each case judged in both orders and saved as soon as
 * it is. The fixture corpus holds no visitor data, so any judge may read it.
 * The summary covers every item, however many resumes it took.
 */
export const pairwiseWork: WorkFn = async (work) => {
  const config = askConfig();
  const params = work.run.params as unknown as PairwiseParams;
  const a = askVariantChain(config, params.a);
  const b = askVariantChain(config, params.b);
  if (!a?.length) return { status: "failed", error: `No model for "${params.a}".` };
  if (!b?.length) return { status: "failed", error: `No model for "${params.b}".` };
  const judgeChain = askChain(config, "judge");
  const byId = new Map(EVAL_CASES.map((c) => [c.id, c]));
  const calls: ModelCall[] = [];
  const paid = paidItems(work, calls);
  const corpus = fixtureAskCorpus(config);
  // Searched by meaning as visitors' answers are, when that is on (plan phase 18): the
  // fixture embedded in memory, its spend recorded with the first case.
  calls.push(...(await embedInMemory(corpus, config)).calls);

  await runPairwise({
    cases: work.keys.flatMap((key) => byId.get(key) ?? []),
    corpus,
    config,
    a: { label: params.a, chain: a },
    b: { label: params.b, chain: b },
    judgeChain,
    pacing: askEvalPacing(),
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    abortSignal: paid.signal,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    calls,
    onStart: (c) => paid.start(c.id),
    onResult: (result) =>
      paid.finish(result.id, result.status === "judged" ? "done" : "unavailable", result),
  });

  const items = (await getRun(work.run.id))?.items ?? [];
  const summary = summarizePairwise({
    a: params.a,
    b: params.b,
    judge: judgeChain[0]?.id ?? null,
    cases: items.length,
    results: items.flatMap((i) =>
      i.status === "done" && i.result ? [i.result as PairwiseCaseResult] : [],
    ),
  });
  const stopped = paid.stoppedBy();
  if (stopped) return { status: "failed", error: stopped, summary };
  if (items.some((i) => i.status === "unavailable")) {
    return { status: "failed", error: PROVIDER_DOWN, summary };
  }
  return { status: "done", summary };
};
