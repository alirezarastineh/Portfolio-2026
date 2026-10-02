import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiMessages, aiReviews } from "../../db/schema.js";
import { askConfig, askCorpus, askEvalPacing, askVisitorJudges } from "../deps.js";
import type { AnswerJudgment, CalibrationPair } from "../evals/calibration.js";
import {
  createModelCallGate,
  FREE_TIER_RATE_LIMIT_RETRY,
  judgeAnswerText,
  judgeDocuments,
} from "../evals/run.js";
import type { ModelCall } from "../models/fallback.js";
import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import type { ModelEntry } from "../models/registry.js";
import { paidItems } from "./paid.js";
import type { WorkFn } from "./runner.js";
import { getRun } from "./store.js";

export const NO_VISITOR_JUDGE =
  "No judge may read visitor answers: SERVER_AI_JUDGE_MODELS must name a model that already answers visitors.";
const JUDGE_DOWN = "The judge stopped answering (quota or outage); resume the run once it is back.";

/** A reviewer's "grounded" verdict, where one was given (not "does not apply"). */
const GROUNDED_GIVEN = sql`${aiReviews.labels} ->> 'grounded' is not null`;

/** Reviewed answers with a grounded verdict and none yet from `judge`, oldest review first. */
export async function reviewedToJudge(judge: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: aiReviews.messageId })
    .from(aiReviews)
    .innerJoin(aiMessages, eq(aiMessages.id, aiReviews.messageId))
    .where(and(GROUNDED_GIVEN, sql`(${aiMessages.judge} ->> 'model') is distinct from ${judge}`))
    .orderBy(asc(aiReviews.reviewedAt));
  return rows.map((r) => r.id);
}

/** The judge's faithfulness next to the reviewer's grounded verdict, per answer both judged. */
export async function calibrationPairs(judge: string): Promise<CalibrationPair[]> {
  return getDb()
    .select({
      faithfulness: sql<number>`(${aiMessages.judge} ->> 'faithfulness')::float8`,
      grounded: sql<boolean>`(${aiReviews.labels} ->> 'grounded')::boolean`,
    })
    .from(aiReviews)
    .innerJoin(aiMessages, eq(aiMessages.id, aiReviews.messageId))
    .where(and(GROUNDED_GIVEN, sql`${aiMessages.judge} ->> 'model' = ${judge}`));
}

interface JudgeContext {
  config: AskConfig;
  chain: ModelEntry[];
  corpus: AskCorpus;
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
  calls: ModelCall[];
  paid: ReturnType<typeof paidItems>;
}

async function judgeOne(
  key: string,
  ctx: JudgeContext,
): Promise<{ ok: true } | { ok: false; down: boolean }> {
  if (ctx.paid.signal.aborted) return { ok: false, down: false };
  await ctx.paid.start(key);
  if (ctx.paid.signal.aborted) return { ok: false, down: false };

  const [message] = await getDb()
    .select({
      question: aiMessages.questionRedacted,
      locale: aiMessages.locale,
      answer: aiMessages.answerExcerpt,
      cited: aiMessages.citedIds,
    })
    .from(aiMessages)
    .where(eq(aiMessages.id, key));

  if (!message) {
    // Pruned since the run started: nothing left to judge.
    await ctx.paid.finish(key, "done", { pruned: true });
    return { ok: true };
  }

  const verdict = await judgeAnswerText({
    config: ctx.config,
    chain: ctx.chain,
    question: message.question,
    locale: message.locale,
    text: message.answer,
    documents: judgeDocuments(ctx.corpus.byId, message.cited),
    abortSignal: ctx.paid.signal,
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    beforeModelCall: ctx.beforeModelCall,
    calls: ctx.calls,
  });

  if (!verdict.value || !verdict.model) {
    await ctx.paid.finish(key, "unavailable");
    return { ok: false, down: !ctx.paid.signal.aborted };
  }

  const judgment: AnswerJudgment = {
    v: 1,
    model: verdict.model,
    ...verdict.value,
    at: new Date().toISOString(),
  };

  await getDb().update(aiMessages).set({ judge: judgment }).where(eq(aiMessages.id, key));
  await ctx.paid.finish(key, "done", judgment);
  return { ok: true };
}

/**
 * Judges the reviewed visitor answers that have no verdict from the current
 * judge yet, so its calibration against people can be measured (plan phase
 * 10; the nightly sampled judge of phase 26 writes the same column). Only a
 * model that already answers visitors may read their answers. The judge
 * reads the redacted question, the stored answer excerpt and the documents
 * the answer cited, as the corpus has them now.
 */
export const judgeWork: WorkFn = async (work) => {
  const config = askConfig();
  const chain = askVisitorJudges(config);
  if (!chain.length) return { status: "failed", error: NO_VISITOR_JUDGE };
  const corpus = await askCorpus(config);
  const pacing = askEvalPacing();
  const beforeModelCall = pacing ? createModelCallGate(pacing) : undefined;
  const calls: ModelCall[] = [];
  const paid = paidItems(work, calls);
  const ctx: JudgeContext = { config, chain, corpus, beforeModelCall, calls, paid };
  let down = false;

  for (const key of work.keys) {
    const outcome = await judgeOne(key, ctx);
    if (!outcome.ok) {
      down = outcome.down;
      break;
    }
  }

  const items = (await getRun(work.run.id))?.items ?? [];
  const summary = {
    answers: items.length,
    judged: items.filter((i) => i.status === "done").length,
    judge: chain[0]!.id,
  };
  const stopped = paid.stoppedBy();
  if (stopped) return { status: "failed", error: stopped, summary };
  if (down) return { status: "failed", error: JUDGE_DOWN, summary };
  return { status: "done", summary };
};
