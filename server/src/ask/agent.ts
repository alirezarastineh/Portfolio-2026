import { randomBytes } from "node:crypto";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import {
  hasToolCall,
  isStepCount,
  NoSuchToolError,
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
  type ModelCall,
  newTrace,
  ProviderStreamError,
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
import {
  shortName,
  withMinimalThinking,
  withThoughts,
  type ModelEntry,
} from "./models/registry.js";
import {
  buildAnswerOnlyInstructions,
  buildInstructions,
  CAREFUL_BLOCKS,
  PROMPT_CANARY,
  PROMPT_HASH,
  PROMPT_VERSION,
  SCOPE,
  SYSTEM_PROMPT,
  type InstructionExtras,
} from "./prompt.js";
import { ESCALATED_ROUTE, escalationOf, type Escalation, type RouteDecision } from "./router.js";
import {
  answerText,
  citationTransform,
  newAnswerRecord,
  recorderTransform,
  smoothText,
  type AnswerRecord,
} from "./stream-transforms.js";
import { countTokens } from "./tokens.js";
import { buildTools, repairToolName, type AskTools } from "./tools.js";
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
  /**
   * The deep chain an answer routed lite moves to once it turns out harder
   * (plan phase 20, `escalationOf`), built only then; absent where the deep
   * route is closed.
   */
  escalation?: () => ModelEntry[];
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
  /** A candidate line after the corpus (`--candidate-reminder`): pairwise evals only. */
  afterCorpus?: string;
  droppedAnswers?: number;
  /** The visitor's earlier questions the conversation window dropped (plan phase 22). */
  window?: { dropped: number };
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
  /** What the answer cost: its model calls and its searches' embeddings. */
  usd: number;
  /**
   * The searches' embedding calls (plan phase 18): written as the `embeddings`
   * feature for a visitor or the playground; an eval run records them itself.
   */
  searchCalls: ModelCall[];
  /** Why the answer moved from the lite to the deep chain mid-way; null when it did not. */
  escalation: Escalation | null;
  /**
   * The model's thoughts (plan phase 23): for the playground and evals only,
   * never a visitor's answer; null there, and when the model returned none.
   */
  reasoning: string | null;
}

/** The step trace, or null: a trace that cannot be built must never cost the answer. */
function safeTrace(
  record: AnswerRecord,
  trace: Trace,
  core: NonNullable<AnswerTrace["core"]>,
  route: Pick<AnswerTrace, "routing" | "escalation" | "window">,
): AnswerTrace | null {
  try {
    return buildAnswerTrace(record.steps, trace, core, route);
  } catch (error) {
    console.error("[ask] could not build the answer trace", error);
    return null;
  }
}

/**
 * The error text the browser receives: a code, never provider details. A
 * provider down before or after its first chunk is `unavailable`; `error` is
 * left for the answer's own failures (a tool the model made up).
 */
export function errorCode(error: unknown): "unavailable" | "timeout" | "error" {
  if (error instanceof AllModelsFailedError || error instanceof ProviderStreamError) {
    return "unavailable";
  }
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

/**
 * The language the answer reads its documents in: the one it is written in
 * (the visitor's, else the page's). Its core holds that language's documents
 * and lists the other's as handles (corpus/render.ts).
 */
export function readingLocale(locale: Locale, language: Locale | null): Locale {
  return language ?? locale;
}

const instructionsMemo = new Map<string, { text: string; tokens: number }>();

function instructionsFor(
  corpus: AskCorpus,
  locale: Locale,
  language: Locale | null,
  extras: InstructionExtras = {},
): { text: string; tokens: number } {
  const reading = readingLocale(locale, language);
  const build = (core: string) => buildInstructions(core, locale, language, extras);
  const make = () => ({
    text: build(corpus.core[reading]),
    tokens: countTokens(build("")) + corpus.coreTokens[reading] + 16,
  });
  // A pairwise eval's candidate: built each time, never memoised.
  if (extras.systemPrompt !== undefined || extras.afterCorpus !== undefined) return make();
  // The key names the reading locale too (it is `language ?? locale`), and the careful topic.
  const key = `${corpus.key}:${locale}:${language}:${extras.careful ?? ""}`;
  let memo = instructionsMemo.get(key);
  if (!memo) {
    // A few page/visitor language pairs and topics per corpus; a new corpus pushes the old out.
    if (instructionsMemo.size >= 32) instructionsMemo.clear();
    memo = make();
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
      // The careful blocks are instructions too (plan phase 20): never to be repeated.
      instructions: [systemPrompt ?? SYSTEM_PROMPT, ...CAREFUL_BLOCKS].join("\n\n"),
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
  corpus: Pick<AskCorpus, "compact">,
  locale?: Locale,
  language: Locale | null = null,
  extras: Omit<InstructionExtras, "afterCorpus"> = {},
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
        content: buildAnswerOnlyInstructions(
          corpus.compact[readingLocale(locale ?? "en", language)],
          locale,
          language,
          extras,
        ),
      },
      ...recent,
    ],
  };
}

/** The route the log keeps: answer-only, a mid-answer escalation, or the router's. */
function loggedRoute(answerOnly: boolean, route: RouteDecision, escalated: boolean): string {
  if (answerOnly) return "answer-only";
  return escalated ? ESCALATED_ROUTE : route.route;
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
  const { config, corpus, locale, language, route } = request;
  const reading = readingLocale(locale, language);
  const messageId = newMessageId();
  const trace = newTrace();
  // Thoughts for the admin's answers only (plan phase 23), named: a visitor never gets or leaves
  // them, nor does any source added later until it is listed here.
  const thoughts = request.source === "playground" || request.source === "eval";
  const thinking = (entries: ModelEntry[]) => (thoughts ? withThoughts(entries) : entries);
  const record = newAnswerRecord(thoughts);
  const cited = new Set<string>();
  const dropped: string[] = [];
  /** What the output guard removed before the visitor saw it. */
  const leaks = new Set<LeakKind>();
  const extras: InstructionExtras = {
    systemPrompt: request.systemPrompt,
    afterCorpus: request.afterCorpus,
    careful: route.sensitive,
  };
  const instructions = instructionsFor(corpus, locale, language, extras);

  // The lookup tier: the same chain, its first model thinking minimally (plan phase 20).
  const chain = thinking(route.lookup ? withMinimalThinking(request.chain) : request.chain);
  const fallbackModel = (entries: ModelEntry[]) =>
    createFallbackModel({
      entries,
      // One trace for the whole answer, whichever chain a step used.
      trace,
      firstChunkTimeoutMs: config.firstChunkTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      retryMaxDelayMs: config.retryMaxDelayMs,
      rateLimitRetry: request.rateLimitRetry,
      acquireRateLimitRetry: request.acquireRateLimitRetry,
      beforeAttempt: request.beforeModelCall,
      answerOnly: (options) => answerOnlyOptions(options, corpus, locale, language, extras),
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
  const model = fallbackModel(chain);
  // An answer routed lite may move up to the deep chain mid-way, never back.
  const escalation = route.route === "lite" ? request.escalation : undefined;
  let escalated: { step: number; reason: Escalation; chain: ModelEntry[] } | null = null;
  let deepModel: ReturnType<typeof fallbackModel> | null = null;
  /** The chain the answer's last step used: the one its fallback is measured against. */
  const answeringChain = () => escalated?.chain ?? chain;

  /** The searches' embedding spend, part of the answer's cost. */
  const searchCalls: ModelCall[] = [];
  const lastRound = config.agentMaxRounds - 1;
  const agent = new ToolLoopAgent({
    model,
    instructions: instructions.text,
    // The tools read in the answer's language too: its documents and pages first.
    tools: buildTools(corpus, reading, {
      config,
      record: request.persist !== false,
      calls: searchCalls,
    }),
    stopWhen: [
      isStepCount(config.agentMaxRounds),
      hasToolCall("handoff_contact"),
      answeredWithFollowups,
    ],
    prepareStep: ({ stepNumber, steps }) => {
      const reason = escalation && !escalated ? escalationOf(steps) : null;
      const deepChain = reason ? thinking(escalation!()) : [];
      if (reason && deepChain.length) {
        escalated = { step: stepNumber, reason, chain: deepChain };
        deepModel = fallbackModel(deepChain);
      }
      return {
        ...(deepModel ? { model: deepModel } : {}),
        // The last round must answer: no more lookups.
        ...(stepNumber >= lastRound ? { activeTools: [] } : {}),
      };
    },
    // A stuttered tool name would fail the whole answer: call the tool it can only mean.
    // An invalid input is never repaired.
    repairToolCall: ({ toolCall, tools, error }) => {
      if (!NoSuchToolError.isInstance(error)) return Promise.resolve(null);
      const name = repairToolName(toolCall.toolName, Object.keys(tools));
      if (!name) return Promise.resolve(null);
      console.warn(`[ask] repaired the tool name ${toolCall.toolName} → ${name}`);
      return Promise.resolve({ ...toolCall, toolName: name });
    },
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
      fallback: usedFallback(trace, answeringChain()),
      answerOnly: answering?.answerOnly ?? false,
      route: escalated ? "deep" : route.route,
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
        citationTransform({ corpus, locale: reading, cited, dropped }),
        // The sandwich's output layer: after the citations, before the words are paced.
        leakGuardTransform(
          guardFor(corpus, config, request.systemPrompt),
          leaks,
          echoOf(request.question),
        ),
        // Thoughts (the admin's answers only) go round the pacing.
        ...smoothText<AskTools>(),
        recorderTransform(record),
      ],
    })
    .then((result) =>
      toUIMessageStream({
        stream: result.stream,
        tools: agent.tools,
        // The playground shows them collapsed; an eval's stream has no reader.
        sendReasoning: thoughts,
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
    const { tokens } = summarizeCalls(trace.calls);
    const usd = summarizeCalls([...trace.calls, ...searchCalls]).usd;
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
      steps: safeTrace(
        record,
        trace,
        { locale: reading, layout: corpus.layout, tokens: corpus.coreTokens[reading] },
        {
          routing: {
            reason: route.reason,
            ...(route.sensitive ? { sensitive: route.sensitive } : {}),
            ...(route.lookup ? { lookup: true as const } : {}),
          },
          ...(escalated ? { escalation: { step: escalated.step, reason: escalated.reason } } : {}),
          ...(request.window ? { window: request.window } : {}),
        },
      ),
      checks: checkAnswer({
        text,
        locale,
        language,
        droppedCitations: dropped,
        toolNames: record.toolCalls.map((c) => c.name),
        finishReason,
        steps: trace.calls.length,
        maxRounds: config.agentMaxRounds,
        degraded: usedFallback(trace, answeringChain()),
        guarded: [...leaks],
        question: request.question,
        toolText,
        secrets,
      }),
      usd,
      searchCalls,
      escalation: escalated?.reason ?? null,
      // Never logged: the eval runner keeps an excerpt of a failed case's (evals/run.ts).
      reasoning: record.reasoning?.trim() || null,
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
        route: loggedRoute(answering?.answerOnly ?? false, route, escalated !== null),
        routeReason: route.reason,
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
