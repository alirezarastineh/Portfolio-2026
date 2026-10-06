import { askChain, askConfig, askEvalPacing } from "../deps.js";
import { embedInMemory } from "../embeddings.js";
import { EVAL_CASES } from "../evals/cases.js";
import { fixtureAskCorpus } from "../evals/fixture.js";
import {
  FREE_TIER_RATE_LIMIT_RETRY,
  runEvals,
  summarizeResults,
  type CaseResult,
} from "../evals/run.js";
import type { ModelCall } from "../models/fallback.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { paidItems, PROVIDER_DOWN } from "./paid.js";
import type { WorkFn } from "./runner.js";
import { getRun } from "./store.js";

/**
 * An eval run in the background: its items are case ids, answered and judged
 * one at a time (free-tier pacing, as in the CLI), each checkpointed with its
 * result and cost as soon as it is graded. Spend is recorded as it happens,
 * and the run's spending lines are checked before every case (paid.ts): a run
 * stops at one, resumable once it resets. The summary covers every item of the
 * run, however many resumes it took.
 */
export const evalWork: WorkFn = async (work) => {
  const config = askConfig();
  const byId = new Map(EVAL_CASES.map((c) => [c.id, c]));
  const corpus = fixtureAskCorpus(config);
  const promptVersion = `${PROMPT_VERSION}+${PROMPT_HASH}`;
  const calls: ModelCall[] = [];
  const paid = paidItems(work, calls);
  // Searched by meaning as visitors' answers are, when that is on (plan phase 18): the
  // fixture embedded in memory, its spend recorded with the first case.
  calls.push(...(await embedInMemory(corpus, config)).calls);

  const partial = await runEvals({
    cases: work.keys.flatMap((key) => byId.get(key) ?? []),
    corpus,
    config,
    chain: (role) => askChain(config, role),
    concurrency: 1,
    pacing: askEvalPacing(),
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    stopOnUnavailable: true,
    abortSignal: paid.signal,
    promptVersion,
    calls,
    onStart: (c) => paid.start(c.id),
    onResult: (result) =>
      paid.finish(result.id, result.status === "unavailable" ? "unavailable" : "done", result),
  });

  const items = (await getRun(work.run.id))?.items ?? [];
  const results = items.flatMap((i) =>
    i.status === "done" && i.result ? [i.result as CaseResult] : [],
  );
  // The run keeps the summary; the per-case results are its items already.
  const summary = {
    ...summarizeResults({
      cases: items.flatMap((i) => byId.get(i.key) ?? []),
      results,
      promptVersion,
      corpus: corpus.key,
      judge: partial.judge,
      usd: items.reduce((sum, i) => sum + i.usd, 0),
    }),
    results: undefined,
  };
  const stopped = paid.stoppedBy();
  if (stopped) return { status: "failed", error: stopped, summary };
  if (partial.unavailable) return { status: "failed", error: PROVIDER_DOWN, summary };
  return { status: "done", summary };
};
