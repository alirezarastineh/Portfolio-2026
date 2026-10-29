import { generateText, Output, type ModelMessage, type UIMessageChunk } from "ai";
import type { z } from "zod";

import type { Locale } from "../content/schema.js";
import { captureError } from "../lib/sentry.js";
import { looksLikeInjection } from "./checks.js";
import type { AskConfig } from "./config.js";
import type { AskCorpus } from "./corpus/index.js";
import { recordSnapshot } from "./corpus/snapshots.js";
import type { Feature } from "./features.js";
import { wasForgotten } from "./forget.js";
import { commonWords } from "./language.js";
import {
  buildLeakGuard,
  deploySecrets,
  echoOf,
  LeakTally,
  newScanState,
  scanChunk,
  type LeakGuard,
} from "./leak-guard.js";
import { logAnswer, type AnswerLog } from "./log.js";
import { createFallbackModel, type ModelCall, type Trace } from "./models/fallback.js";
import type { ModelEntry } from "./models/registry.js";
import { PROMPT_CANARY } from "./prompt.js";
import { withoutMarkers } from "./stream-transforms.js";
import { countTokens } from "./tokens.js";
import { recordUsage } from "./usage.js";

/**
 * What a structured planner shares (the tour, V16; match, V19): one call on a
 * chain's models with structured output, checked by code the model cannot
 * change, repaired once with the exact failures; the text gates its critic
 * applies; the output guard over its instructions; the stream that logs its
 * row however it ends.
 */

/** One check a model's answer failed: its gate, and what is wrong, as the model reads it. */
export interface GateFailure {
  gate: string;
  message: string;
}

export const LANGUAGE_NAME: Record<Locale, string> = { en: "English", de: "German" };
const LINK = /https?:\/\/|\bwww\.|\]\(/i;
const FENCE_TAG = /<\/?\s*visitor\b/i;

export const wordCount = (text: string) => withoutMarkers(text).split(" ").filter(Boolean).length;

/**
 * Why a text reads as an instruction, or null: the injection patterns, a link,
 * the fence, the guard. The visitor's own words are no leak when it repeats them.
 */
export function instructionIn(
  text: string,
  guard: LeakGuard | null,
  visitorText: string,
): string | null {
  if (looksLikeInjection(text)) return "it reads as an instruction";
  if (LINK.test(text)) return "it holds a link";
  if (FENCE_TAG.test(text)) return "it holds a visitor tag";
  if (guard) {
    const hits = new LeakTally();
    scanChunk(guard, newScanState(), text, true, hits, echoOf(visitorText));
    if (hits.kinds().size) return "it repeats the instructions";
  }
  return null;
}

/** Whether the text's common words are the other language's. */
export function otherLanguage(text: string, language: Locale): boolean {
  const words = commonWords(withoutMarkers(text));
  return words[language === "de" ? "en" : "de"] > words[language];
}

const guardMemo = new Map<string, LeakGuard>();

/** The output guard for a planner's texts: its instructions, never to be repeated. */
export function guardFor(
  name: string,
  instructions: () => string,
  corpus: AskCorpus,
  config: AskConfig,
): LeakGuard {
  const key = `${name}:${corpus.key}`;
  let guard = guardMemo.get(key);
  if (!guard) {
    if (guardMemo.size >= 16) guardMemo.clear();
    guard = buildLeakGuard({
      instructions: instructions(),
      corpusTexts: corpus.documents.map((d) => d.text),
      quotable: [],
      canary: PROMPT_CANARY,
      secrets: deploySecrets(config),
    });
    guardMemo.set(key, guard);
  }
  return guard;
}

/** The models of a chain that answer in a schema: the others are skipped. */
export const structuredChain = (chain: readonly ModelEntry[]): ModelEntry[] =>
  chain.filter((entry) => entry.structuredOutputs);

export interface StructuredCall {
  maxOutputTokens: number;
  temperature: number;
  maxRetries: number;
}

/** One structured call on `chain`, through the fallback model: what each attempt sends. */
export function structuredAsk<T>(options: {
  chain: ModelEntry[];
  schema: z.ZodType<T>;
  instructions: string;
  call: StructuredCall;
  trace: Trace;
  config: AskConfig;
  abortSignal: AbortSignal;
  /** A failover before the answer's first chunk (visitor plan V12). */
  onFailover?: (next: { position: number; of: number }) => void;
  /** Bulk evals pace each provider request through this. */
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
}): (messages: ModelMessage[]) => Promise<T> {
  const { config } = options;
  const model = createFallbackModel({
    entries: options.chain,
    trace: options.trace,
    firstChunkTimeoutMs: config.firstChunkTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    beforeAttempt: options.beforeModelCall,
    onFailover: options.onFailover,
    estimateTokens: (call) => countTokens(JSON.stringify(call.prompt)),
  });
  return async (messages) =>
    (
      await generateText({
        model,
        instructions: options.instructions,
        messages,
        output: Output.object({ schema: options.schema }),
        abortSignal: options.abortSignal,
        ...options.call,
      })
    ).output as T;
}

/** The repair turn: the request, the answer as the model's own, the exact failures; checked again. */
export async function repairOnce<T, F extends GateFailure>(
  value: T,
  messages: ModelMessage[],
  note: string,
  ask: (messages: ModelMessage[]) => Promise<T>,
  check: (value: T) => F[],
): Promise<{ value: T; failures: F[] }> {
  const repaired = await ask([
    ...messages,
    { role: "assistant", content: JSON.stringify(value) },
    { role: "user", content: note },
  ]);
  return { value: repaired, failures: check(repaired) };
}

/** The time to the first chunk and in all, as a finish and a row report them. */
export function timings(trace: Trace): { ttftMs: number | null; totalMs: number } {
  return {
    ttftMs: trace.firstTokenAt === null ? null : trace.firstTokenAt - trace.startedAt,
    totalMs: Date.now() - trace.startedAt,
  };
}

/**
 * The stream a planner's message goes out on. `finish` runs exactly once,
 * however it ends: read to the end, a read error (sent on as an `error`
 * chunk, and passed to `finish`), or the visitor gone.
 */
export function closingStream(
  ui: ReadableStream<UIMessageChunk>,
  finish: (ending: "finished" | "aborted", error?: unknown) => Promise<void>,
): ReadableStream<UIMessageChunk> {
  let finished = false;
  const end = async (ending: "finished" | "aborted", error?: unknown) => {
    if (finished) return;
    finished = true;
    await finish(ending, error);
  };
  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        reader ??= ui.getReader();
        const { done: ended, value } = await reader.read();
        if (ended) {
          controller.close();
          await end("finished");
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.enqueue({ type: "error", errorText: "error" });
        controller.close();
        await end("finished", error);
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => undefined);
      await end("aborted");
    },
  });
}

/** How a planner's stream ended, as its row records it: aborted, failed, or stopped. */
export function finishReasonOf(
  ending: "finished" | "aborted",
  signal: AbortSignal,
  failure: unknown,
): string {
  if (ending === "aborted" || signal.aborted) return "aborted";
  return failure ? "error:error" : "stop";
}

/**
 * A planner's row, however its stream ended: the usage first (spent whether or
 * not the row is kept), then the row unless the visitor forgot the session
 * meanwhile, then the corpus snapshot. Never throws: a failure is logged and
 * reported as `<label>-log`.
 */
export async function logRow(options: {
  feature: Feature;
  calls: ModelCall[];
  sessionHash: string;
  corpus: AskCorpus;
  entry: () => AnswerLog;
  label: string;
}): Promise<void> {
  try {
    if (options.calls.length) await recordUsage(options.calls, options.feature);
    if (wasForgotten(options.sessionHash)) return;
    await logAnswer(options.entry());
    await recordSnapshot(options.corpus);
  } catch (error) {
    console.error(`[ask] could not record the ${options.label}`, error);
    captureError(error, { phase: `${options.label}-log` });
  }
}
