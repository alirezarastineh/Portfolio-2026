import { and, eq } from "drizzle-orm";

import type { Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import { aiMessages } from "../../db/schema.js";
import { snapshotKey } from "../corpus/snapshots.js";
import { askChain, askConfig, askCorpus, askEvalPacing } from "../deps.js";
import {
  answerCase,
  createModelCallGate,
  createRetryAcquirer,
  FREE_TIER_RATE_LIMIT_RETRY,
  type EvalOptions,
} from "../evals/run.js";
import { applyReplay, getEntry, REPLAYABLE } from "../journal-store.js";
import { replayResultOf, type ReplayResult } from "../journal.js";
import type { ModelCall } from "../models/fallback.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { paidItems, PROVIDER_DOWN } from "./paid.js";
import type { WorkFn, WorkOutcome } from "./runner.js";
import { getRun } from "./store.js";

/**
 * Diagnose's paid experiment (plan phase 24): a journal entry's question
 * answered again on today's corpus, by the lite chain alone and by the deep
 * chain alone, so the evidence can say whether the model, the route or a
 * passing outage was the cause. A run of kind `agent` (its spending line,
 * switched off until the admin turns it on), started and confirmed by the
 * admin; fenced per chain and recorded as usage (paid.ts). The answers are
 * evals' (`persist: false`, nothing logged as a visitor's); the run keeps
 * their outcomes, never their text. The entry gets the replay only once every
 * chain has answered: a chain with no model answering fails the run, which a
 * resume finishes; an entry fixed or retired meanwhile gets nothing more.
 */

export const REPLAY_CHAINS = ["lite", "deep"] as const;
type Chain = (typeof REPLAY_CHAINS)[number];

export const ANSWER_GONE =
  "The answer was pruned (after 90 days): there is no question left to replay.";

/** The run's params: what to replay, by ids (no visitor text in the run). */
interface ReplayParams {
  task: "replay";
  entry: string;
  messageId: string;
}

/** What a replay of `entryId` works through, or why it cannot start. */
export async function planReplay(
  entryId: string,
): Promise<
  { params: Record<string, unknown>; keys: string[] } | { error: string; status: 400 | 409 }
> {
  const entry = await getEntry(entryId);
  if (!entry) return { error: "unknown_entry", status: 400 };
  if (!REPLAYABLE.includes(entry.status)) return { error: "not_replayable", status: 409 };
  const messageId = entry.messageIds[0];
  const [message] = messageId
    ? await getDb()
        .select({ id: aiMessages.id })
        .from(aiMessages)
        .where(and(eq(aiMessages.id, messageId), eq(aiMessages.source, "terminal")))
    : [];
  if (!message) return { error: "answer_gone", status: 409 };
  const config = askConfig();
  const keys = REPLAY_CHAINS.filter((chain) => askChain(config, chain).length);
  if (!keys.length) return { error: "no_chain", status: 400 };
  const params: ReplayParams = { task: "replay", entry: entry.id, messageId: message.id };
  return { params: { ...params }, keys };
}

/**
 * The question answered by one chain alone: no escalation, so each side is its
 * own evidence. A replay tests today's system, so the lite side is routed as
 * today's router routes the question (the lookup tier included, whatever the
 * visitor's answer got); the deep side as the `deep` command routes, never
 * with the lookup tier's minimal thinking.
 */
async function answerOn(
  chain: Chain,
  options: EvalOptions,
  message: { question: string; locale: Locale },
): Promise<ReplayResult> {
  const { outcome, operationalFailure } = await answerCase(
    chain === "deep" ? { ...options, routing: { deep: true } } : options,
    {
      id: `replay-${chain}`,
      category: "production",
      locale: message.locale,
      question: message.question,
      judge: false,
    },
    createRetryAcquirer(options.rateLimitRetry),
    { chain: askChain(options.config, chain) },
  );
  return replayResultOf(
    chain,
    {
      text: outcome.text,
      finishReason: outcome.finishReason,
      citedIds: outcome.citedIds,
      toolNames: outcome.toolCalls.map((t) => t.name),
      model: outcome.model,
      flags: outcome.checks.flags,
      usd: outcome.usd,
    },
    operationalFailure,
  );
}

export const replayWork: WorkFn = async (work) => {
  const params = work.run.params as Partial<ReplayParams>;
  if (params.task !== "replay" || !params.entry || !params.messageId) {
    return { status: "failed", error: "Not a replay: an agent run of another task." };
  }
  const [message] = await getDb()
    .select({ question: aiMessages.questionRedacted, locale: aiMessages.locale })
    .from(aiMessages)
    .where(eq(aiMessages.id, params.messageId));
  if (!message) return { status: "failed", error: ANSWER_GONE };

  const config = askConfig();
  const corpus = await askCorpus(config);
  const calls: ModelCall[] = [];
  const paid = paidItems(work, calls);
  const pacing = askEvalPacing();
  const options: EvalOptions = {
    cases: [],
    corpus,
    config,
    chain: (role) => askChain(config, role),
    judge: false,
    pacing,
    rateLimitRetry: FREE_TIER_RATE_LIMIT_RETRY,
    abortSignal: paid.signal,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    calls,
    beforeModelCall: pacing ? createModelCallGate(pacing) : undefined,
  };

  for (const key of work.keys) {
    if (paid.signal.aborted) break;
    const halt = await replayOne(key, params.entry, options, message, paid);
    if (halt) return halt;
  }
  return written(work, paid, params.entry, snapshotKey(corpus));
};

async function replayOne(
  key: string,
  entry: string,
  options: EvalOptions,
  message: { question: string; locale: Locale },
  paid: ReturnType<typeof paidItems>,
): Promise<WorkOutcome | null> {
  // Checked before each chain spends: an entry deleted, fixed or retired gets no more.
  const halt = await halted(entry);
  if (halt) return halt;
  await paid.start(key);
  if (paid.signal.aborted) return null;
  const result = await answerOn(key === "deep" ? "deep" : "lite", options, message);
  await paid.finish(key, result.unavailable ? "unavailable" : "done", result);
  return null;
}

export const ENTRY_DECIDED =
  "The entry was fixed or retired meanwhile: it is the admin's record, and the replay stopped.";

/** How the run ends when its entry is gone or decided; null while it may go on. */
async function halted(entryId: string): Promise<WorkOutcome | null> {
  const entry = await getEntry(entryId);
  if (!entry) return { status: "done", summary: { note: "The entry was deleted meanwhile." } };
  if (!REPLAYABLE.includes(entry.status)) return { status: "failed", error: ENTRY_DECIDED };
  return null;
}

/** How the run ends: stopped, cut short, or every chain answered and the entry analysed again. */
async function written(
  work: Parameters<WorkFn>[0],
  paid: ReturnType<typeof paidItems>,
  entry: string,
  corpusKey: string,
): Promise<WorkOutcome> {
  const items = (await getRun(work.run.id))?.items ?? [];
  const results = items.flatMap((i) =>
    (i.status === "done" || i.status === "unavailable") && i.result
      ? [i.result as ReplayResult]
      : [],
  );
  const summary = {
    chains: results.map((r) => ({
      chain: r.chain,
      answered: r.answered,
      unavailable: r.unavailable,
    })),
  };
  const stopped = paid.stoppedBy();
  if (stopped) return { status: "failed", error: stopped, summary };
  // Cancelled or interrupted: the runner records it; a resume answers the chains left.
  if (paid.signal.aborted) return { status: "done", summary };
  // A chain with no model answering: no evidence yet. A resume asks it again; until every
  // chain has answered, the entry gets nothing, so an outage cannot pass for a cause.
  if (results.some((r) => r.unavailable))
    return { status: "failed", error: PROVIDER_DOWN, summary };
  if (results.length < items.length) {
    return { status: "failed", error: "Not every chain answered; resume the run.", summary };
  }

  const applied = await applyReplay(entry, {
    runId: work.run.id,
    at: new Date().toISOString(),
    corpusKey,
    results,
  });
  if (applied === "answer_gone") return { status: "failed", error: ANSWER_GONE, summary };
  if (applied === "entry_decided") return { status: "failed", error: ENTRY_DECIDED, summary };
  if (applied === "entry_gone") {
    return { status: "done", summary: { ...summary, note: "The entry was deleted meanwhile." } };
  }
  return { status: "done", summary };
}
