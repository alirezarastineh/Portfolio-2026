import { randomBytes } from "node:crypto";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import {
  hasToolCall,
  isStepCount,
  smoothStream,
  ToolLoopAgent,
  toUIMessageStream,
  type ModelMessage,
  type StopCondition,
  type UIMessageChunk,
} from "ai";

import type { Locale } from "../content/schema.js";
import { captureError } from "../lib/sentry.js";
import { raiseAlert } from "./audit.js";
import { checkAnswer, leakReached, type AnswerChecks } from "./checks.js";
import type { AskConfig } from "./config.js";
import type { AskCorpus } from "./corpus/index.js";
import { recordSnapshot, snapshotKey } from "./corpus/snapshots.js";
import { signAnswer } from "./history.js";
import { logAnswer } from "./log.js";
import {
  AllModelsFailedError,
  AttemptTimeoutError,
  answeringModel,
  createFallbackModel,
  newTrace,
  type RateLimitRetryOptions,
  usedFallback,
  type Trace,
} from "./models/fallback.js";
import {
  buildLeakGuard,
  deploySecrets,
  echoOf,
  leakGuardTransform,
  type LeakGuard,
  type LeakKind,
} from "./leak-guard.js";
import { shortName, type ModelEntry } from "./models/registry.js";
import {
  buildAnswerOnlyInstructions,
  buildInstructions,
  PROMPT_CANARY,
  PROMPT_HASH,
  PROMPT_VERSION,
  SCOPE,
  SYSTEM_PROMPT,
} from "./prompt.js";
import type { RouteDecision } from "./router.js";
import {
  answerText,
  citationTransform,
  newAnswerRecord,
  recorderTransform,
  type AnswerRecord,
} from "./stream-transforms.js";
import { countTokens } from "./tokens.js";
import { buildTools, type AskTools } from "./tools.js";
import { buildAnswerTrace, type AnswerTrace } from "./trace.js";
import { recordUsage, summarizeCalls } from "./usage.js";

/**
 * One answer, end to end: a tool-loop agent over the fallback chain, streamed
 * as UI message chunks (text, tool steps, sources, metadata), checked and
 * signed on the way out, and logged — with its cost — however the stream ends:
 * finished, failed, or abandoned by the visitor.
 */

/** Sent with the answer's finish; the terminal's meta line and history read it. */
export interface AnswerMetadata {
  createdAt?: number;
  sig?: string;
  model?: string | null;
  fallback?: boolean;
  answerOnly?: boolean;
  route?: RouteDecision["route"];
  ttftMs?: number | null;
  totalMs?: number;
  tokens?: { input: number; cached: number; output: number };
  finishReason?: string | null;
}

export interface AnswerRequest {
  messages: ModelMessage[];
  question: string;
  locale: Locale;
  /** The language the visitor writes in, when clear; the answer is in it. */
  language: Locale | null;
  sessionId: string;
  sessionHash: string;
  source: "terminal" | "playground" | "eval";
  route: RouteDecision;
  corpus: AskCorpus;
  config: AskConfig;
  chain: ModelEntry[];
  abortSignal: AbortSignal;
  /** Bulk evals may wait once for 429; interactive requests leave this unset. */
  rateLimitRetry?: RateLimitRetryOptions;
  /** Shares the bounded 429 retry allowance across every model call in one eval case. */
  acquireRateLimitRetry?: () => boolean;
  /** Bulk evals pace every physical provider request through this shared gate. */
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
  /** Extra total time reserved for deliberate eval pacing and a bounded 429 wait. */
  timeoutExtraMs?: number;
  /** A candidate prompt in place of `SYSTEM_PROMPT`: pairwise evals only, never a request. */
  systemPrompt?: string;
  droppedAnswers?: number;
  /**
   * Write the log row and the usage totals (default). Off for evals run from
   * a laptop, whose database is the production one.
   */
  persist?: boolean;
  /** Called once the stream is over, whatever the outcome (frees the concurrency slot). */
  onClose?: () => void;
}

export interface AnswerOutcome {
  messageId: string;
  text: string;
  citedIds: string[];
  /** Citation ids the model made up (removed before the visitor saw them). */
  droppedCitations: string[];
  toolCalls: AnswerRecord["toolCalls"];
  finishReason: string;
  model: string | null;
  trace: Trace;
  /** What the answer did, step by step, as the log stores it; null if it could not be built. */
  steps: AnswerTrace | null;
  /** The deterministic checks' flags (checks.ts). */
  checks: AnswerChecks;
  usd: number;
}

/** The step trace, or null: a trace that cannot be built must never cost the answer. */
function safeTrace(record: AnswerRecord, trace: Trace): AnswerTrace | null {
  try {
    return buildAnswerTrace(record.steps, trace);
  } catch (error) {
    console.error("[ask] could not build the answer trace", error);
    return null;
  }
}

/** The error text the browser receives: a code, never provider details. */
export function errorCode(error: unknown): "unavailable" | "timeout" | "error" {
  if (error instanceof AllModelsFailedError) return "unavailable";
  if (error instanceof AttemptTimeoutError) return "timeout";
  const name = (error as { name?: string } | null)?.name ?? "";
  if (/timeout/i.test(name)) return "timeout";
  return "error";
}

export function resolveFinishReason(
  ending: "finished" | "aborted",
  record: Pick<AnswerRecord, "aborted" | "error" | "finishReason">,
): string {
  if (ending === "aborted" || record.aborted) {
    return "aborted";
  }
  if (record.error) {
    return `error:${errorCode(record.error)}`;
  }
  return record.finishReason ?? "unknown";
}

export function newMessageId(): string {
  return `m_${randomBytes(12).toString("base64url")}`;
}

const instructionsMemo = new Map<string, { text: string; tokens: number }>();

function instructionsFor(
  corpus: AskCorpus,
  locale: Locale,
  language: Locale | null,
  systemPrompt?: string,
): { text: string; tokens: number } {
  if (systemPrompt !== undefined) {
    // A pairwise eval's candidate prompt: built each time, never memoised.
    return {
      text: buildInstructions(corpus.core, locale, language, systemPrompt),
      tokens:
        countTokens(buildInstructions("", locale, language, systemPrompt)) + corpus.coreTokens + 16,
    };
  }
  const key = `${corpus.key}:${locale}:${language}`;
  let memo = instructionsMemo.get(key);
  if (!memo) {
    // A few page/visitor language pairs per corpus; a new corpus pushes the old out.
    if (instructionsMemo.size >= 16) instructionsMemo.clear();
    memo = {
      text: buildInstructions(corpus.core, locale, language),
      tokens: countTokens(buildInstructions("", locale, language)) + corpus.coreTokens + 16,
    };
    instructionsMemo.set(key, memo);
  }
  return memo;
}

/**
 * The alert for a leak: removed by the guard before the visitor saw it
 * (denied), or written and only found by the check afterwards (allowed).
 */
export function leakAlert(messageId: string, leaks: ReadonlySet<LeakKind>, reached: boolean) {
  const removed = leaks.size
    ? `${[...leaks].sort((a, b) => a.localeCompare(b)).join(", ")} removed before the visitor saw it`
    : null;
  const shown = reached ? "a piece of the instructions or a secret reached the visitor" : null;
  return {
    actor: "agent" as const,
    action: "answer",
    target: messageId,
    // Denied only when nothing got through.
    decision: reached ? ("allowed" as const) : ("denied" as const),
    reason: `leak: ${[removed, shown].filter(Boolean).join("; ")}`,
  };
}

const guardMemo = new Map<string, LeakGuard>();

/**
 * The output guard for answers from this corpus (plan phase 15,
 * leak-guard.ts): the instructions they must not repeat, less what the corpus
 * says too, and the secrets the deploy holds. Built once per corpus.
 */
function guardFor(corpus: AskCorpus, config: AskConfig, systemPrompt?: string): LeakGuard {
  const build = () =>
    buildLeakGuard({
      instructions: systemPrompt ?? SYSTEM_PROMPT,
      corpusTexts: corpus.documents.map((d) => d.text),
      quotable: [SCOPE],
      canary: PROMPT_CANARY,
      secrets: deploySecrets(config),
    });
  // A pairwise eval's candidate prompt: built each time, never memoised.
  if (systemPrompt !== undefined) return build();
  let memo = guardMemo.get(corpus.key);
  if (!memo) {
    if (guardMemo.size >= 8) guardMemo.clear();
    memo = build();
    guardMemo.set(corpus.key, memo);
  }
  return memo;
}

function messageTokens(message: LanguageModelV4Message): number {
  return countTokens(
    typeof message.content === "string" ? message.content : JSON.stringify(message.content),
  );
}

/** A model without tools gets the compact corpus, no tool traffic and a short history. */
export function answerOnlyOptions(
  options: LanguageModelV4CallOptions,
  corpus: AskCorpus,
  locale?: Locale,
  language: Locale | null = null,
  systemPrompt?: string,
): LanguageModelV4CallOptions {
  const turns: LanguageModelV4Prompt = [];
  for (const message of options.prompt) {
    if (message.role === "system" || message.role === "tool") continue;
    if (message.role === "assistant") {
      const content = message.content.filter((p) => p.type === "text");
      if (content.length) turns.push({ ...message, content });
      continue;
    }
    turns.push(message);
  }
  let recent = turns.slice(-5);
  while (recent[0] && recent[0].role !== "user") recent = recent.slice(1);
  return {
    ...options,
    tools: undefined,
    toolChoice: undefined,
    prompt: [
      {
        role: "system",
        content: buildAnswerOnlyInstructions(corpus.compact, locale, language, systemPrompt),
      },
      ...recent,
    ],
  };
}

/** Stop once the model has answered and offered follow-ups: nothing is left to say. */
const answeredWithFollowups: StopCondition<AskTools> = ({ steps }) => {
  const last = steps.at(-1);
  if (!last?.toolCalls.some((call) => call.toolName === "suggest_followups")) return false;
  return steps.some((step) => step.text.trim().length > 0);
};

export function streamAnswer(request: AnswerRequest): {
  messageId: string;
  stream: ReadableStream<UIMessageChunk>;
  done: Promise<AnswerOutcome>;
} {
  const { config, corpus, locale, language } = request;
  const messageId = newMessageId();
  const trace = newTrace();
  const record = newAnswerRecord();
  const cited = new Set<string>();
  const dropped: string[] = [];
  /** What the output guard removed before the visitor saw it. */
  const leaks = new Set<LeakKind>();
  const instructions = instructionsFor(corpus, locale, language, request.systemPrompt);

  const model = createFallbackModel({
    entries: request.chain,
    trace,
    firstChunkTimeoutMs: config.firstChunkTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    rateLimitRetry: request.rateLimitRetry,
    acquireRateLimitRetry: request.acquireRateLimitRetry,
    beforeAttempt: request.beforeModelCall,
    answerOnly: (options) =>
      answerOnlyOptions(options, corpus, locale, language, request.systemPrompt),
    estimateTokens: (options) =>
      options.prompt.reduce(
        (sum, message) =>
          sum +
          (message.role === "system" && message.content === instructions.text
            ? instructions.tokens
            : messageTokens(message)),
        0,
      ),
  });

  const lastRound = config.agentMaxRounds - 1;
  const agent = new ToolLoopAgent({
    model,
    instructions: instructions.text,
    tools: buildTools(corpus, locale),
    stopWhen: [
      isStepCount(config.agentMaxRounds),
      hasToolCall("handoff_contact"),
      answeredWithFollowups,
    ],
    // The last round must answer: no more lookups.
    prepareStep: ({ stepNumber }) => (stepNumber >= lastRound ? { activeTools: [] } : {}),
    maxOutputTokens: config.maxOutputTokens,
    temperature: 0.3,
    // The fallback chain owns retries.
    maxRetries: 0,
  });

  const metadataAtFinish = (): AnswerMetadata => {
    const answering = answeringModel(trace);
    const { tokens } = summarizeCalls(trace.calls);
    return {
      sig: signAnswer(request.sessionId, messageId, answerText(record)),
      model: answering ? shortName(answering.model) : null,
      fallback: usedFallback(trace, request.chain),
      answerOnly: answering?.answerOnly ?? false,
      route: request.route.route,
      ttftMs: trace.firstTokenAt === null ? null : trace.firstTokenAt - trace.startedAt,
      totalMs: Date.now() - trace.startedAt,
      tokens: { input: tokens.input, cached: tokens.cached, output: tokens.output },
      finishReason: record.finishReason,
    };
  };

  // Started now, read when the response body is pulled.
  const ui = agent
    .stream({
      messages: request.messages,
      abortSignal: request.abortSignal,
      timeout: {
        totalMs: config.streamTimeoutMs + (request.timeoutExtraMs ?? 0),
        chunkMs: config.chunkTimeoutMs,
      },
      experimental_transform: [
        citationTransform({ corpus, locale, cited, dropped }),
        // The sandwich's output layer: after the citations, before the words are paced.
        leakGuardTransform(
          guardFor(corpus, config, request.systemPrompt),
          leaks,
          echoOf(request.question),
        ),
        smoothStream({ chunking: "word" }),
        recorderTransform(record),
      ],
    })
    .then((result) =>
      toUIMessageStream({
        stream: result.stream,
        tools: agent.tools,
        sendReasoning: false,
        sendSources: true,
        generateMessageId: () => messageId,
        messageMetadata: ({ part }) => {
          if (part.type === "start") return { createdAt: Date.now() } satisfies AnswerMetadata;
          if (part.type === "finish") return metadataAtFinish();
          return undefined;
        },
        onError: (error) => {
          record.error ??= error;
          return errorCode(error);
        },
      }),
    );

  let resolveDone!: (outcome: AnswerOutcome) => void;
  const done = new Promise<AnswerOutcome>((resolve) => (resolveDone = resolve));
  let finished = false;

  const finish = async (ending: "finished" | "aborted") => {
    if (finished) return;
    finished = true;
    request.onClose?.();

    const answering = answeringModel(trace);
    const { tokens, usd } = summarizeCalls(trace.calls);
    const finishReason = resolveFinishReason(ending, record);
    const text = answerText(record);
    // The tools' inputs reach the visitor too (follow-ups, the hand-off summary): checked, not filtered.
    const toolText = record.toolCalls.map((c) => JSON.stringify(c.input ?? "")).join("\n");
    const secrets = deploySecrets(config);
    const outcome: AnswerOutcome = {
      messageId,
      text,
      citedIds: [...cited],
      droppedCitations: dropped,
      toolCalls: record.toolCalls,
      finishReason,
      model: answering?.model ?? null,
      trace,
      steps: safeTrace(record, trace),
      checks: checkAnswer({
        text,
        locale,
        language,
        droppedCitations: dropped,
        toolNames: record.toolCalls.map((c) => c.name),
        finishReason,
        steps: trace.calls.length,
        maxRounds: config.agentMaxRounds,
        degraded: usedFallback(trace, request.chain),
        guarded: [...leaks],
        question: request.question,
        toolText,
        secrets,
      }),
      usd,
    };

    if (record.error && !(record.error instanceof AllModelsFailedError) && ending !== "aborted") {
      console.error("[ask] answer failed", record.error);
      captureError(record.error, { phase: "ask" });
    }
    try {
      if (request.persist === false) {
        resolveDone(outcome);
        return;
      }
      // The source names the feature that spent: the terminal, the playground, an eval.
      if (trace.calls.length) await recordUsage(trace.calls, request.source);
      await logAnswer({
        id: messageId,
        sessionHash: request.sessionHash,
        locale,
        language,
        source: request.source,
        route: answering?.answerOnly ? "answer-only" : request.route.route,
        routeReason: request.route.reason,
        question: request.question,
        answer: outcome.text,
        citedIds: outcome.citedIds,
        toolCalls: record.toolCalls.map((c) => c.name),
        model: outcome.model,
        attempts: trace.attempts,
        ttftMs: trace.firstTokenAt === null ? null : trace.firstTokenAt - trace.startedAt,
        totalMs: Date.now() - trace.startedAt,
        tokens,
        usd,
        finishReason,
        promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
        droppedAnswers: request.droppedAnswers ?? 0,
        trace: outcome.steps,
        droppedCitations: dropped,
        // The documents it saw, exactly (`snapshotKey`), so a case frozen from it replays them.
        corpusKey: snapshotKey(corpus),
        checks: outcome.checks,
      });
      // The corpus this visitor's answer saw, kept so a case frozen from it
      // re-runs against the same documents (playground drafts are not kept).
      if (request.source === "terminal") await recordSnapshot(corpus);
    } catch (error) {
      console.error("[ask] could not record the answer", error);
      captureError(error, { phase: "ask-log" });
    }
    // A piece of the instructions or a secret was written for a visitor: the
    // owner hears of it at once, even when the answer could not be logged.
    if (request.source === "terminal" && outcome.checks.flags.includes("leak")) {
      const reached = leakReached({ text, question: request.question, toolText, secrets });
      await raiseAlert(leakAlert(messageId, leaks, reached)).catch((error: unknown) =>
        console.error("[ask] leak alert not written", error),
      );
    }
    resolveDone(outcome);
  };

  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  const stream = new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        reader ??= (await ui).getReader();
        const { done: ended, value } = await reader.read();
        if (ended) {
          controller.close();
          await finish("finished");
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        record.error ??= error;
        controller.enqueue({ type: "error", errorText: errorCode(error) });
        controller.close();
        await finish("finished");
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => undefined);
      await finish("aborted");
    },
  });

  return { messageId, stream, done };
}
