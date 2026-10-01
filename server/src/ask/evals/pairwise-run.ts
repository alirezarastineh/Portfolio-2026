import { generateText, Output } from "ai";
import { z } from "zod";

import { newTrace } from "../models/fallback.js";
import type { ModelEntry } from "../models/registry.js";
import { wrapVisitor } from "../prompt.js";
import { summarizeCalls } from "../usage.js";
import type { EvalCase } from "./cases.js";
import {
  combineOrders,
  summarizePairwise,
  type PairChoice,
  type PairwiseCaseResult,
  type PairwiseSide,
  type PairwiseSummary,
} from "./pairwise.js";
import {
  answerCase,
  createModelCallGate,
  createRetryAcquirer,
  JUDGE_FENCE,
  judgeDocuments,
  judgeModelFor,
  type AnsweredCase,
  type AnswerVariant,
  type EvalOptions,
} from "./run.js";

/**
 * Runs a pairwise eval (pairwise.ts): every case answered by A and by B
 * through the real agent, each side graded by the deterministic checks, then
 * judged twice with the answers' positions swapped. Paced like `runEvals`,
 * one case at a time; a case that cannot be answered or judged stops the run
 * (`unavailable`), so a background run can resume it.
 */

/** A side: its name in reports, and how it answers. */
export interface PairwiseVariant extends AnswerVariant {
  label: string;
}

export interface PairwiseOptions extends Omit<
  EvalOptions,
  "chain" | "judge" | "onResult" | "concurrency" | "stopOnUnavailable"
> {
  a: PairwiseVariant;
  b: PairwiseVariant;
  judgeChain: ModelEntry[];
  onResult?: (result: PairwiseCaseResult) => void | Promise<void>;
}

const pairSchema = z.object({
  better: z.enum(["1", "2", "tie"]).describe("The better answer: 1, 2, or tie when neither is"),
  reason: z.string().max(300).describe("Why, in one sentence"),
});

const CHOICE: Record<z.infer<typeof pairSchema>["better"], PairChoice> = {
  "1": "first",
  "2": "second",
  tie: "tie",
};

/** Faithfulness first, then helpfulness; length is named, since judges favour it. */
const PAIR_INSTRUCTIONS = `You compare two answers an AI assistant gave to the same question about a person's portfolio. Prefer the answer whose factual claims the documents support; between equally faithful answers, prefer the one that serves the question better. A claim counts as supported only if the documents state it. Statements that something is not in the portfolio, polite declines and offers to contact are not factual claims. Length is not quality: never prefer an answer for being longer or more detailed. Say tie when neither is better. ${JUDGE_FENCE}`;

async function judgePair(
  options: EvalOptions,
  c: EvalCase,
  first: string,
  second: string,
  documents: string,
  acquire?: () => boolean,
): Promise<{ choice: PairChoice | null; reason: string }> {
  const trace = newTrace();
  const model = judgeModelFor(options, options.chain("judge"), trace, acquire);
  try {
    const result = await generateText({
      model,
      abortSignal: options.abortSignal,
      maxRetries: 0,
      temperature: 0,
      output: Output.object({ schema: pairSchema }),
      instructions: PAIR_INSTRUCTIONS,
      prompt: `Question:\n${wrapVisitor(c.question, c.locale)}\n\nAnswer 1:\n${first || "(no text)"}\n\nAnswer 2:\n${second || "(no text)"}\n\nDocuments the answers cited:\n${documents}`,
    });
    return { choice: CHOICE[result.output.better], reason: result.output.reason };
  } catch (error) {
    console.warn(`[eval] pairwise judge failed for ${c.id}`, (error as Error).message);
    return { choice: null, reason: "" };
  } finally {
    options.calls?.push(...trace.calls);
  }
}

function side(answered: AnsweredCase): PairwiseSide {
  return {
    answer: answered.outcome.text,
    model: answered.outcome.model,
    failures: answered.failures,
    usd: answered.outcome.usd,
  };
}

/** Transient failures a one-model side retries (each retry also waits for its pacing slot). */
const SIDE_RETRIES = 3;

/**
 * A side of one model has nothing to fail over to. The interactive
 * first-chunk timeout (there to switch models quickly for visitors) would
 * only cut a slow thinker off, and one "high demand" 503 would end the run:
 * such a side waits for its first chunk up to the request timeout and retries
 * transient failures a few times. A route side keeps its chain's behaviour,
 * failover included.
 */
function sideOptions(options: EvalOptions, variant: AnswerVariant): EvalOptions {
  if (variant.chain.length !== 1) return options;
  const { config } = options;
  return {
    ...options,
    config: {
      ...config,
      firstChunkTimeoutMs: Math.max(config.firstChunkTimeoutMs, config.requestTimeoutMs - 1_000),
      maxRetries: Math.max(config.maxRetries, SIDE_RETRIES),
    },
  };
}

async function pairCase(
  options: EvalOptions,
  input: PairwiseOptions,
  c: EvalCase,
): Promise<PairwiseCaseResult> {
  const calls = options.calls!;
  const from = calls.length;
  const acquire = createRetryAcquirer(options.rateLimitRetry);
  const a = await answerCase(sideOptions(options, input.a), c, acquire, input.a);
  const b = await answerCase(sideOptions(options, input.b), c, acquire, input.b);
  const base = { id: c.id, category: c.category, a: side(a), b: side(b) };
  const unavailable = (reasons: string[]): PairwiseCaseResult => ({
    ...base,
    status: "unavailable",
    verdicts: null,
    outcome: null,
    reasons,
    usd: summarizeCalls(calls.slice(from)).usd,
  });
  if (a.operationalFailure || b.operationalFailure) {
    return unavailable([`answer ${a.operationalFailure ? "A" : "B"} failed`]);
  }

  const cited = [...new Set([...a.outcome.citedIds, ...b.outcome.citedIds])];
  const documents = judgeDocuments(options.corpus.byId, cited);
  const aFirst = await judgePair(options, c, a.outcome.text, b.outcome.text, documents, acquire);
  const bFirst = aFirst.choice
    ? await judgePair(options, c, b.outcome.text, a.outcome.text, documents, acquire)
    : null;
  if (!aFirst.choice || !bFirst?.choice) return unavailable(["judge unavailable"]);
  return {
    ...base,
    status: "judged",
    verdicts: { aFirst: aFirst.choice, bFirst: bFirst.choice },
    outcome: combineOrders(aFirst.choice, bFirst.choice),
    reasons: [aFirst.reason, bFirst.reason],
    usd: summarizeCalls(calls.slice(from)).usd,
  };
}

export async function runPairwise(input: PairwiseOptions): Promise<PairwiseSummary> {
  const options: EvalOptions = {
    ...input,
    // A side answers with its own chain; the judge role gets the judge chain.
    chain: (role) => (role === "judge" ? input.judgeChain : input.a.chain),
    calls: input.calls ?? [],
    beforeModelCall: input.pacing ? createModelCallGate(input.pacing) : undefined,
    onResult: undefined,
  };
  const results: PairwiseCaseResult[] = [];
  for (const c of input.cases) {
    if (input.abortSignal?.aborted) break;
    await input.onStart?.(c);
    // Stopped between cases (a cancel, a spent budget): the rest stay undone.
    if (input.abortSignal?.aborted) break;
    const result = await pairCase(options, input, c);
    results.push(result);
    await input.onResult?.(result);
    if (result.status === "unavailable") break;
  }
  return summarizePairwise({
    a: input.a.label,
    b: input.b.label,
    judge: input.judgeChain[0]?.id ?? null,
    cases: input.cases.length,
    results,
  });
}
