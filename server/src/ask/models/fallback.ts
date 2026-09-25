import { randomInt } from "node:crypto";
import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
  type LanguageModelV4StreamPart,
  type LanguageModelV4StreamResult,
  type LanguageModelV4Usage,
  type SharedV4ProviderOptions,
} from "@ai-sdk/provider";

import { recordFailure, recordSuccess, releaseProbe, tryAcquire } from "./circuit.js";
import type { ModelEntry } from "./registry.js";

/**
 * One language model made of a chain of real ones. For each call it tries the
 * chain in order and moves on (before the visitor has seen anything) when a
 * model is rate-limited, erroring, unreachable or silent past the first-chunk
 * timeout. Once the first content has streamed it never switches, because the
 * visitor would see the answer start twice: a later failure ends the stream
 * with an error part and the terminal offers `retry`.
 *
 * The SDK's own retries are off (`maxRetries: 0` on the agent); retries live
 * here, only for 5xx and network errors, a few times, jittered. Bulk evals
 * may opt into one bounded 429 retry; visitor requests still fall back at once.
 */

export type AttemptOutcome =
  | "ok"
  | "rate-limited"
  | "server-error"
  | "client-error"
  | "network"
  | "timeout"
  | "skipped-open"
  | "skipped-missing"
  | "skipped-capability"
  | "skipped-context";

export interface Attempt {
  model: string;
  outcome: AttemptOutcome;
  ms: number;
  error?: string;
  answerOnly?: boolean;
}

/** One successful model call: an agent answer makes one per step. */
export interface ModelCall {
  model: string;
  answerOnly: boolean;
  ttftMs: number | null;
  usage: LanguageModelV4Usage | null;
  finishReason: string | null;
}

export interface Trace {
  startedAt: number;
  /** When the first content of the whole answer arrived. */
  firstTokenAt: number | null;
  attempts: Attempt[];
  calls: ModelCall[];
}

export function newTrace(now = Date.now()): Trace {
  return { startedAt: now, firstTokenAt: null, attempts: [], calls: [] };
}

function formatAttempts(attempts: readonly Attempt[]): string {
  if (attempts.length === 0) return "none configured";
  return attempts.map((a) => `${a.model}=${a.outcome}`).join(", ");
}

export class AllModelsFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(`no model could answer: ${formatAttempts(attempts)}`);
    this.name = "AllModelsFailedError";
  }
}

export class AttemptTimeoutError extends Error {
  constructor(readonly phase: "first-chunk" | "request") {
    super(`${phase} timeout`);
    this.name = "AttemptTimeoutError";
  }
}

export interface RateLimitRetryOptions {
  maxRetries: number;
  defaultDelayMs: number;
  maxDelayMs: number;
}

export interface FallbackOptions {
  entries: ModelEntry[];
  trace: Trace;
  firstChunkTimeoutMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Optional, eval-only wait-and-retry policy for provider rate limits. */
  rateLimitRetry?: RateLimitRetryOptions;
  /** Optional shared budget; evals use this to allow one 429 retry per case. */
  acquireRateLimitRetry?: () => boolean;
  /** Called immediately before each physical provider request, including retries. */
  beforeAttempt?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
  /**
   * Rebuilds a request for a model without tools (compact corpus, no tools,
   * shorter history). Without it, such models are skipped when tools are needed.
   */
  answerOnly?: (options: LanguageModelV4CallOptions) => LanguageModelV4CallOptions;
  /** Prompt size in tokens, to skip models whose context window is too small. */
  estimateTokens: (options: LanguageModelV4CallOptions) => number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface Classified {
  outcome: AttemptOutcome;
  retryable: boolean;
  retryAfterMs: number | null;
  message: string;
}

function retryAfterMs(headers: Record<string, string> | undefined, now: number): number | null {
  const raw = headers?.["retry-after"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  return "Unknown error";
}

export function classifyError(error: unknown, now = Date.now()): Classified {
  if (error instanceof AttemptTimeoutError) {
    return { outcome: "timeout", retryable: false, retryAfterMs: null, message: error.message };
  }
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    const message = `${status} ${error.message}`.slice(0, 200);
    if (status === 429) {
      return {
        outcome: "rate-limited",
        retryable: false,
        retryAfterMs: retryAfterMs(error.responseHeaders, now),
        message,
      };
    }
    if (status >= 500 || status === 408) {
      return { outcome: "server-error", retryable: true, retryAfterMs: null, message };
    }
    if (status === 0) return { outcome: "network", retryable: true, retryAfterMs: null, message };
    return { outcome: "client-error", retryable: false, retryAfterMs: null, message };
  }
  const message = errorMessage(error);
  return {
    outcome: "network",
    retryable: true,
    retryAfterMs: null,
    message: message.slice(0, 200),
  };
}

/** Anything the visitor would see: text, a tool step, a source. Metadata is not. */
function isContent(part: LanguageModelV4StreamPart): boolean {
  switch (part.type) {
    case "text-delta":
    case "reasoning-delta":
      return part.delta.length > 0;
    case "tool-input-start":
    case "tool-call":
    case "tool-result":
    case "source":
    case "file":
      return true;
    default:
      return false;
  }
}

function mergeProviderOptions(
  base: SharedV4ProviderOptions | undefined,
  extra: SharedV4ProviderOptions | undefined,
): SharedV4ProviderOptions | undefined {
  if (!extra) return base;
  const merged: SharedV4ProviderOptions = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = { ...base?.[key], ...value };
  }
  return merged;
}

function hasTools(options: LanguageModelV4CallOptions): boolean {
  return (options.tools?.length ?? 0) > 0;
}

/** Rejects when `deadline` passes first; the loser is left to settle on its own. */
function beforeDeadline<T>(
  promise: PromiseLike<T>,
  deadline: number,
  now: () => number,
  phase: AttemptTimeoutError["phase"],
): Promise<T> {
  const remaining = deadline - now();
  if (remaining <= 0) return Promise.reject(new AttemptTimeoutError(phase));
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AttemptTimeoutError(phase)), remaining);
    }),
  ]).finally(() => clearTimeout(timer));
}

function assertNotAborted(signal?: AbortSignal, entryId?: string, error?: unknown): void {
  if (signal?.aborted) {
    if (entryId) releaseProbe(entryId);
    throw error ?? signal.reason;
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error("request aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

export function createFallbackModel(options: FallbackOptions): LanguageModelV4 {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const { trace } = options;

  function backoff(retry: number): number {
    const exp = Math.min(options.retryMaxDelayMs, options.retryBaseDelayMs * 2 ** retry);
    const min = Math.round(exp * 0.5);
    const max = Math.round(exp);
    return min >= max ? min : randomInt(min, max + 1);
  }

  async function waitBeforeRetry(ms: number, signal: AbortSignal | undefined, entryId: string) {
    try {
      await sleep(ms, signal);
    } catch (error) {
      assertNotAborted(signal, entryId, error);
      releaseProbe(entryId);
      throw error;
    }
    assertNotAborted(signal, entryId);
  }

  /**
   * The request for one model, or why it cannot take it. Models without tools
   * get the answer-only rebuild; a prompt that still does not fit is skipped.
   */
  function prepare(
    entry: ModelEntry,
    call: LanguageModelV4CallOptions,
  ): { options: LanguageModelV4CallOptions; answerOnly: boolean } | AttemptOutcome {
    let prepared: LanguageModelV4CallOptions = {
      ...call,
      providerOptions: mergeProviderOptions(call.providerOptions, entry.providerOptions),
    };
    let answerOnly = false;
    if (!entry.tools) {
      if (options.answerOnly) {
        prepared = options.answerOnly(prepared);
        answerOnly = true;
      } else if (hasTools(call)) {
        return "skipped-capability";
      }
    }
    const needed = options.estimateTokens(prepared) + (prepared.maxOutputTokens ?? 0);
    if (needed > entry.contextWindow) return "skipped-context";
    return { options: prepared, answerOnly };
  }

  function qualifyEntry(
    entry: ModelEntry,
    call: LanguageModelV4CallOptions,
  ): { options: LanguageModelV4CallOptions; answerOnly: boolean } | AttemptOutcome {
    if (!entry.available) return "skipped-missing";
    const prep = prepare(entry, call);
    if (typeof prep === "string") return prep;
    if (!tryAcquire(entry.id, now())) return "skipped-open";
    return prep;
  }

  async function tryEntryWithRetries<T>(
    entry: ModelEntry,
    prepared: { options: LanguageModelV4CallOptions; answerOnly: boolean },
    call: LanguageModelV4CallOptions,
    attempt: (
      entry: ModelEntry,
      prepared: LanguageModelV4CallOptions,
      record: ModelCall,
    ) => Promise<T>,
  ): Promise<{ ok: true; result: T } | { ok: false; attempt: Attempt }> {
    let transientRetries = 0;
    let rateLimitRetries = 0;
    for (;;) {
      try {
        await options.beforeAttempt?.(entry, call.abortSignal);
        assertNotAborted(call.abortSignal, entry.id);
      } catch (error) {
        assertNotAborted(call.abortSignal, entry.id, error);
        throw error;
      }
      const started = now();
      const record: ModelCall = {
        model: entry.id,
        answerOnly: prepared.answerOnly,
        ttftMs: null,
        usage: null,
        finishReason: null,
      };
      try {
        const result = await attempt(entry, prepared.options, record);
        const attemptEntry: Attempt = {
          model: entry.id,
          outcome: "ok",
          ms: now() - started,
        };
        if (prepared.answerOnly) attemptEntry.answerOnly = true;
        trace.attempts.push(attemptEntry);
        trace.calls.push(record);
        return { ok: true, result };
      } catch (error) {
        assertNotAborted(call.abortSignal, entry.id, error);
        const failure = classifyError(error, now());
        if (
          failure.outcome === "rate-limited" &&
          options.rateLimitRetry &&
          (options.acquireRateLimitRetry?.() ??
            rateLimitRetries < options.rateLimitRetry.maxRetries)
        ) {
          rateLimitRetries++;
          const requested = failure.retryAfterMs ?? options.rateLimitRetry.defaultDelayMs;
          await waitBeforeRetry(
            Math.min(requested, options.rateLimitRetry.maxDelayMs),
            call.abortSignal,
            entry.id,
          );
          continue;
        }
        if (failure.retryable && transientRetries < options.maxRetries) {
          await waitBeforeRetry(backoff(transientRetries), call.abortSignal, entry.id);
          transientRetries++;
          continue;
        }
        recordFailure(
          entry.id,
          {
            error: failure.message,
            rateLimited: failure.outcome === "rate-limited",
            retryAfterMs: failure.retryAfterMs,
          },
          now(),
        );
        const failedAttempt: Attempt = {
          model: entry.id,
          outcome: failure.outcome,
          ms: now() - started,
          error: failure.message,
        };
        trace.attempts.push(failedAttempt);
        console.warn(`[ask] ${entry.id} failed (${failure.outcome}): ${failure.message}`);
        return { ok: false, attempt: failedAttempt };
      }
    }
  }

  /**
   * Walks the chain. `attempt` either returns (the model is answering) or
   * throws; the loop records the outcome and decides whether to retry here,
   * move on, or give up because the visitor left.
   */
  async function walk<T>(
    call: LanguageModelV4CallOptions,
    attempt: (
      entry: ModelEntry,
      prepared: LanguageModelV4CallOptions,
      record: ModelCall,
    ) => Promise<T>,
  ): Promise<T> {
    const attempts: Attempt[] = [];
    for (const entry of options.entries) {
      const prepared = qualifyEntry(entry, call);
      if (typeof prepared === "string") {
        const skipped: Attempt = { model: entry.id, outcome: prepared, ms: 0 };
        trace.attempts.push(skipped);
        attempts.push(skipped);
        continue;
      }

      const outcome = await tryEntryWithRetries(entry, prepared, call, attempt);
      if (outcome.ok) return outcome.result;
      attempts.push(outcome.attempt);
    }
    throw new AllModelsFailedError(attempts);
  }

  async function streamOne(
    entry: ModelEntry,
    call: LanguageModelV4CallOptions,
    record: ModelCall,
  ): Promise<LanguageModelV4StreamResult> {
    const started = now();
    const firstDeadline = started + options.firstChunkTimeoutMs;
    const requestDeadline = started + options.requestTimeoutMs;

    // Our timeouts and the visitor leaving both abort the provider's request.
    const controller = new AbortController();
    const caller = call.abortSignal;
    const onCallerAbort = () => controller.abort(caller?.reason);
    caller?.addEventListener("abort", onCallerAbort, { once: true });
    const detach = () => caller?.removeEventListener("abort", onCallerAbort);

    let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined;
    const buffered: LanguageModelV4StreamPart[] = [];
    let result: LanguageModelV4StreamResult;
    try {
      result = await beforeDeadline(
        entry.model.doStream({ ...call, abortSignal: controller.signal }),
        firstDeadline,
        now,
        "first-chunk",
      );
      reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await beforeDeadline(
          reader.read(),
          firstDeadline,
          now,
          "first-chunk",
        );
        if (done) break;
        if (value.type === "error") throw value.error;
        buffered.push(value);
        if (isContent(value)) break;
      }
    } catch (error) {
      controller.abort(error);
      void reader?.cancel().catch(() => undefined);
      detach();
      throw error;
    }

    record.ttftMs = now() - started;
    trace.firstTokenAt ??= now();
    recordSuccess(entry.id, record.ttftMs, now());

    const activeReader = reader;
    let closed = false;
    const close = () => {
      if (closed) return false;
      closed = true;
      detach();
      return true;
    };
    const forward = (
      part: LanguageModelV4StreamPart,
      out: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
    ) => {
      if (part.type === "finish") {
        record.usage = part.usage;
        record.finishReason = part.finishReason.unified;
      }
      out.enqueue(part);
    };

    const stream = new ReadableStream<LanguageModelV4StreamPart>({
      start(out) {
        for (const part of buffered) forward(part, out);
      },
      async pull(out) {
        try {
          const { done, value } = await beforeDeadline(
            activeReader.read(),
            requestDeadline,
            now,
            "request",
          );
          if (done) {
            close();
            out.close();
            return;
          }
          forward(value, out);
        } catch (error) {
          if (!close()) return;
          controller.abort(error);
          void activeReader.cancel().catch(() => undefined);
          if (!caller?.aborted) {
            recordFailure(entry.id, { error: classifyError(error, now()).message }, now());
          }
          out.enqueue({ type: "error", error });
          out.close();
        }
      },
      async cancel(reason) {
        close();
        controller.abort(reason);
        await activeReader.cancel(reason).catch(() => undefined);
      },
    });

    return { ...result, stream };
  }

  async function generateOne(
    entry: ModelEntry,
    call: LanguageModelV4CallOptions,
    record: ModelCall,
  ): Promise<LanguageModelV4GenerateResult> {
    const started = now();
    const controller = new AbortController();
    const caller = call.abortSignal;
    const onCallerAbort = () => controller.abort(caller?.reason);
    caller?.addEventListener("abort", onCallerAbort, { once: true });
    try {
      const result = await beforeDeadline(
        entry.model.doGenerate({ ...call, abortSignal: controller.signal }),
        started + options.requestTimeoutMs,
        now,
        "request",
      );
      record.ttftMs = now() - started;
      record.usage = result.usage;
      record.finishReason = result.finishReason.unified;
      trace.firstTokenAt ??= now();
      recordSuccess(entry.id, null, now());
      return result;
    } catch (error) {
      controller.abort(error);
      throw error;
    } finally {
      caller?.removeEventListener("abort", onCallerAbort);
    }
  }

  const first = options.entries[0]?.id ?? "none";
  return {
    specificationVersion: "v4",
    provider: "portfolio.fallback",
    modelId: first,
    supportedUrls: {},
    doStream: (call) => walk(call, streamOne),
    doGenerate: (call) => walk(call, generateOne),
  };
}

/** The model that produced the answer: the last one that was called. */
export function answeringModel(trace: Trace): ModelCall | null {
  return trace.calls.at(-1) ?? null;
}

/** True when the answer did not come from the first model the chain would use. */
export function usedFallback(trace: Trace, chain: readonly ModelEntry[]): boolean {
  const call = answeringModel(trace);
  return !!call && (call.model !== chain[0]?.id || call.answerOnly);
}
