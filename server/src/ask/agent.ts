import { randomBytes } from "node:crypto";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import {
  createUIMessageStream,
  hasToolCall,
  isStepCount,
  NoSuchToolError,
  streamText,
  ToolLoopAgent,
  toUIMessageStream,
  type ModelMessage,
  type StopCondition,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";

import type { Locale } from "../content/schema.js";
import { captureError } from "../lib/sentry.js";
import {
  closingChunks,
  lookupsOf,
  mergeInOrder,
  renameTextIds,
  repairMessages,
  type MergeEnd,
  type StepResults,
} from "./answer-repair.js";
import { raiseAlert } from "./audit.js";
import { wasForgotten } from "./forget.js";
import {
  answerShape,
  checkAnswer,
  leakReached,
  repairReason,
  type AnswerChecks,
  type RepairReason,
} from "./checks.js";
import type { AskConfig } from "./config.js";
import type { AskCorpus } from "./corpus/index.js";
import { recordSnapshot, snapshotKey } from "./corpus/snapshots.js";
import { handoffOffer, type HandoffOffer } from "./handoff.js";
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
  LeakTally,
  type LeakGuard,
  type LeakKind,
} from "./leak-guard.js";
import {
  shortName,
  withMinimalThinking,
  withThoughts,
  type ModelEntry,
} from "./models/registry.js";
import type { Focus } from "./focus.js";
import type { PageDocument } from "./page.js";
import {
  buildAnswerOnlyInstructions,
  buildInstructions,
  CAREFUL_BLOCKS,
  closingLine,
  CONTACT_BLOCK,
  FOCUS_SAMPLES,
  focusInstruction,
  LEVEL_INSTRUCTIONS,
  PAGE_SAMPLE,
  pageInstruction,
  PROMPT_CANARY,
  PROMPT_HASH,
  PROMPT_VERSION,
  REPAIR_LINE,
  SCOPE,
  SYSTEM_PROMPT,
  withSelection,
  type InstructionExtras,
  type ReaderLevel,
} from "./prompt.js";
import { answerReceipt, type AnswerReceipt } from "./receipt.js";
import { ESCALATED_ROUTE, escalationOf, type Escalation, type RouteDecision } from "./router.js";
import {
  answerText,
  citationTransform,
  fenceTransform,
  newAnswerRecord,
  recorderTransform,
  smoothText,
  type AnswerRecord,
} from "./stream-transforms.js";
import { countTokens } from "./tokens.js";
import { FETCH_CLIP } from "./tool-defs.js";
import { buildTools, fetchedText, repairToolName, type AskTools } from "./tools.js";
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
  /**
   * The hand-off this answer offers (visitor plan V6): by the model's tool or
   * by the server, with the summary the form gets (checked, or the visitor's
   * own words). The terminal shows the offer from it.
   */
  handoff?: { by: HandoffOffer["by"]; summary: string };
  /**
   * What the answer did, as counts and codes (visitor plan V12): the
   * terminal's receipt line and the hero's trace panel read it.
   */
  receipt?: AnswerReceipt;
}

/**
 * A transient status during the answer (visitor plan V12): the chain moved on
 * from a model that failed before its first chunk. Sent as a `data-status`
 * part the browser shows until the first words, never stored or replayed.
 */
export interface FailoverStatus {
  code: "failover";
  /** The next model's place among the chain's callable ones. */
  position: number;
  of: number;
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
  /** The case study or post the question was asked on (visitor plan V8, `pageDocument`). */
  page?: PageDocument | null;
  /**
   * Whether a page the core does not hold whole brings its text into the page
   * block (default). Off for the eval CLI's `--no-page-promote`, the A/B.
   */
  promotePage?: boolean;
  /** What the visitor points at on the page (visitor plan V9, `focusOf`). */
  focus?: Focus | null;
  /** How technical the visitor asked answers to be, when not standard (visitor plan V10). */
  level?: ReaderLevel;
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
  /** The verifier's repair of an answer without words (visitor plan V5); null when none. */
  repair: NonNullable<AnswerTrace["repair"]> | null;
  /** The hand-off it offered, by the model or the server (visitor plan V6); null when none. */
  handoff: HandoffOffer | null;
}

/** The step trace, or null: a trace that cannot be built must never cost the answer. */
function safeTrace(
  record: AnswerRecord,
  trace: Trace,
  core: NonNullable<AnswerTrace["core"]>,
  route: Pick<
    AnswerTrace,
    | "routing"
    | "escalation"
    | "window"
    | "repair"
    | "handoff"
    | "page"
    | "focus"
    | "level"
    | "guard"
  >,
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
  // A pairwise eval's candidate, and what a visitor points at (an excerpt, perhaps a selection):
  // built each time, never memoised.
  if (extras.systemPrompt !== undefined || extras.afterCorpus !== undefined || extras.focus) {
    return make();
  }
  // The key names the reading locale too (it is `language ?? locale`), the page and whether its
  // text came along, the level, the careful topic and the request block.
  const promoted = extras.page?.text === undefined ? "" : "+text";
  const page = extras.page ? `${extras.page.id}${promoted}` : "";
  const key = `${corpus.key}:${locale}:${language}:${page}:${extras.level ?? ""}:${extras.careful ?? ""}:${extras.contact ? "contact" : ""}`;
  let memo = instructionsMemo.get(key);
  if (!memo) {
    // A few language pairs, pages and topics per corpus; a new corpus pushes the old out.
    if (instructionsMemo.size >= 64) instructionsMemo.clear();
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
      // The careful blocks (plan phase 20), the repair line, the request block and the page,
      // focus and level blocks' own words (visitor plan V5, V6, V8–V10) are instructions too:
      // never to be repeated.
      instructions: [
        systemPrompt ?? SYSTEM_PROMPT,
        ...CAREFUL_BLOCKS,
        REPAIR_LINE,
        CONTACT_BLOCK,
        pageInstruction(PAGE_SAMPLE),
        ...FOCUS_SAMPLES.map(focusInstruction),
        ...LEVEL_INSTRUCTIONS,
      ].join("\n\n"),
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

/** The agent's steps, for what its lookups returned; none if they cannot be read. */
async function stepsOf(result: {
  steps: PromiseLike<readonly StepResults[]>;
}): Promise<readonly StepResults[]> {
  try {
    return await result.steps;
  } catch {
    return [];
  }
}

/**
 * The conversation with its last message, the visitor's question, carrying
 * their selection too (visitor plan V9): a selection the page does not hold.
 */
function withSelectionIn(
  messages: ModelMessage[],
  question: string,
  selection: string,
  locale: Locale,
): ModelMessage[] {
  if (messages.at(-1)?.role !== "user") return messages;
  return [
    ...messages.slice(0, -1),
    { role: "user", content: withSelection(question, selection, locale) },
  ];
}

/** Whether the answer opened the home page's contact section: an offer there would repeat it. */
function openedContact(calls: AnswerRecord["toolCalls"]): boolean {
  return calls.some((call) => {
    const to = (call.input as { to?: unknown } | null)?.to;
    return call.name === "navigate" && typeof to === "string" && to.endsWith("#contact");
  });
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
  /** What the output guard removed before the visitor saw it, by kind and count. */
  const leaks = new LeakTally();
  /** Tells the browser of a failover, once the answer's stream is open (visitor plan V12). */
  let status: ((data: FailoverStatus) => void) | null = null;
  // The case study or post asked on (visitor plan V8): named in the page block, its text
  // promoted there, cut as a fetch would cut it, when the core does not hold it whole.
  const page = request.page ?? null;
  const promoted = page !== null && page.held !== "whole" && request.promotePage !== false;
  const pageText = page && promoted ? fetchedText(page.document.text, FETCH_CLIP) : undefined;
  const extras: InstructionExtras = {
    systemPrompt: request.systemPrompt,
    afterCorpus: request.afterCorpus,
    ...(page
      ? {
          page: {
            id: page.document.id,
            title: page.document.title,
            url: page.document.url,
            ...(pageText === undefined ? {} : { text: pageText }),
          },
        }
      : {}),
    // What the visitor points at on the page (visitor plan V9): its block, after the page's.
    ...(request.focus?.block ? { focus: request.focus.block } : {}),
    // The level they chose (visitor plan V10); standard adds nothing.
    ...(request.level ? { level: request.level } : {}),
    careful: route.sensitive,
    contact: route.intent === "contact",
  };
  const instructions = instructionsFor(corpus, locale, language, extras);
  // A selection the page does not hold joins the visitor's question, inside its fence: their
  // words, as the guard knows them too.
  const fenced = request.focus?.fenced ?? null;
  const messages = fenced
    ? withSelectionIn(request.messages, request.question, fenced, locale)
    : request.messages;
  const visitorWords = fenced ? `${request.question}\n${fenced}` : request.question;

  // The lookup tier: the same chain, the primary model thinking minimally (plan phase 20).
  const chain = thinking(
    route.lookup ? withMinimalThinking(request.chain, config.gemini.model) : request.chain,
  );
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
      onFailover: (next) => status?.({ code: "failover", ...next }),
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
    // The tools read in the answer's language too: its documents and pages first. A promoted
    // page is read already.
    tools: buildTools(
      corpus,
      reading,
      { config, record: request.persist !== false, calls: searchCalls },
      page && promoted ? { id: page.document.id, length: page.document.text.length } : undefined,
    ),
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
      ...(handoff ? { handoff: { by: handoff.by, summary: handoff.summary } } : {}),
      receipt: answerReceipt(traceDetails(), {
        toolNames: record.toolCalls.map((c) => c.name),
        cited: cited.size,
        dropped,
      }),
    };
  };

  const onError = (error: unknown) => {
    record.error ??= error;
    return errorCode(error);
  };
  /** The verifier's one repair, once it ran (visitor plan V5). */
  let repair: AnswerOutcome["repair"] = null;
  /** The hand-off offered, decided once the words are in (visitor plan V6). */
  let handoff: HandoffOffer | null = null;
  /** The agent's own model calls, counted before a repair: its call is not a round. */
  let agentCalls: number | null = null;
  const guard = guardFor(corpus, config, request.systemPrompt);

  /**
   * The answer's words go through the same layers whoever writes them: an
   * echoed visitor fence dropped, the citations checked, then the output guard
   * (the sandwich's output layer), then the pacing, which thoughts (the
   * admin's answers only) go round, then the recorder.
   */
  const transforms = (into: AnswerRecord) => [
    fenceTransform<AskTools>(),
    citationTransform<AskTools>({ corpus, locale: reading, cited, dropped }),
    leakGuardTransform<AskTools>(guard, leaks, echoOf(visitorWords)),
    ...smoothText<AskTools>(),
    recorderTransform<AskTools>(into),
  ];

  /**
   * One more call on the answer's chain, tools off, for the words it lacked
   * (visitor plan V5), then the fixed closing line if it has none either. Its
   * words are the answer's (the same record, citations and guard); its failure
   * is its own, so the closing line answers instead of an error.
   */
  async function repairAnswer(
    writer: UIMessageStreamWriter,
    reason: RepairReason,
    steps: readonly StepResults[],
  ): Promise<void> {
    const left =
      trace.startedAt + config.streamTimeoutMs + (request.timeoutExtraMs ?? 0) - Date.now();
    // The answer's text, steps and tool calls; the repair's own ending.
    const own: AnswerRecord = {
      ...record,
      finishReason: null,
      error: null,
      aborted: false,
      reasoning: record.reasoning === null ? null : "",
    };
    let end: MergeEnd = "done";
    if (left >= config.firstChunkTimeoutMs) {
      const result = streamText({
        model: fallbackModel(answeringChain()),
        // The answer's own bytes: the cached prefix holds.
        instructions: instructions.text,
        messages: repairMessages(messages, lookupsOf(steps)),
        abortSignal: request.abortSignal,
        timeout: { totalMs: left, chunkMs: config.chunkTimeoutMs },
        maxOutputTokens: config.maxOutputTokens,
        temperature: 0.3,
        maxRetries: 0,
        experimental_transform: [renameTextIds<AskTools>("repair-"), ...transforms(own)],
      });
      end = await mergeInOrder(
        writer,
        toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          sendFinish: false,
          sendReasoning: thoughts,
          sendSources: true,
          onError: (error) => {
            own.error ??= error;
            return errorCode(error);
          },
        }),
        { keep: (chunk) => chunk.type !== "error", onFailure: "end" },
      );
    }
    if (own.reasoning && record.reasoning !== null) record.reasoning += own.reasoning;
    const words = answerShape(record, request.question).words;
    repair = { reason, by: words || end === "cancelled" ? "model" : "fixed-line" };
    if (end === "cancelled" || own.aborted) {
      record.aborted = true;
      return;
    }
    if (!words) {
      const line = closingLine(reading);
      for (const chunk of closingChunks("closing", line)) writer.write(chunk);
      record.textOrder.push("closing");
      record.texts.set("closing", line);
    }
    // The visitor got a finished answer, however its words came.
    record.finishReason = words && own.finishReason ? own.finishReason : "stop";
  }

  // Started when the response body is first pulled. One message, perhaps two calls: the
  // agent's stream without its finish, the repair's when the verifier asks for one, then the
  // finish, whose metadata and signature cover the whole text.
  const ui = createUIMessageStream({
    execute: async ({ writer }) => {
      // Transient: the browser shows it until the first words; it is never part of the message.
      status = (data) => writer.write({ type: "data-status", data, transient: true });
      const result = await agent.stream({
        messages,
        abortSignal: request.abortSignal,
        timeout: {
          totalMs: config.streamTimeoutMs + (request.timeoutExtraMs ?? 0),
          chunkMs: config.chunkTimeoutMs,
        },
        experimental_transform: transforms(record),
      });
      const held: { finish?: Extract<UIMessageChunk, { type: "finish" }> } = {};
      const end = await mergeInOrder(
        writer,
        toUIMessageStream({
          stream: result.stream,
          tools: agent.tools,
          // The playground shows them collapsed; an eval's stream has no reader.
          sendReasoning: thoughts,
          sendSources: true,
          generateMessageId: () => messageId,
          messageMetadata: ({ part }) =>
            part.type === "start"
              ? ({ createdAt: Date.now() } satisfies AnswerMetadata)
              : undefined,
          onError,
        }),
        {
          keep: (chunk) => {
            if (chunk.type !== "finish") return true;
            held.finish = chunk;
            return false;
          },
        },
      );
      if (end !== "done") return;
      const reason = repairReason(answerShape(record, request.question));
      if (reason) {
        agentCalls = trace.calls.length;
        await repairAnswer(writer, reason, await stepsOf(result));
      }
      // The visitor asked to reach him: the model's offer, its summary checked, or the server's.
      const call = record.toolCalls.find((c) => c.name === "handoff_contact");
      handoff = handoffOffer({
        intent: route.intent === "contact",
        call: call ? { input: call.input } : null,
        finished: answerShape(record).ending === "finished",
        openedContact: openedContact(record.toolCalls),
        question: request.question,
        language: reading,
      });
      if (held.finish) {
        writer.write({
          ...held.finish,
          ...(repair ? { finishReason: "stop" as const } : {}),
          messageMetadata: metadataAtFinish(),
        });
      }
    },
    onError,
  });

  let resolveDone!: (outcome: AnswerOutcome) => void;
  const done = new Promise<AnswerOutcome>((resolve) => (resolveDone = resolve));
  let finished = false;

  const traceDetails = () => ({
    routing: {
      reason: route.reason,
      ...(route.sensitive ? { sensitive: route.sensitive } : {}),
      ...(route.lookup ? { lookup: true as const } : {}),
      ...(route.intent ? { intent: route.intent } : {}),
    },
    ...(escalated ? { escalation: { step: escalated.step, reason: escalated.reason } } : {}),
    ...(request.window ? { window: request.window } : {}),
    ...(repair ? { repair } : {}),
    ...(handoff
      ? {
          handoff: {
            by: handoff.by,
            ...(handoff.replaced ? { replaced: true as const } : {}),
          },
        }
      : {}),
    ...(page ? { page: { id: page.document.id, promoted } } : {}),
    ...(request.focus ? { focus: request.focus.trace } : {}),
    ...(request.level ? { level: request.level } : {}),
    guard: leaks.record(),
  });

  const persistOutcome = async (
    outcome: AnswerOutcome,
    details: {
      answering: ReturnType<typeof answeringModel>;
      tokens: ReturnType<typeof summarizeCalls>["tokens"];
      toolText: string;
      secrets: string[];
    },
  ) => {
    if (request.persist === false) return;
    try {
      // The source names the feature that spent: the terminal, the playground, an eval.
      if (trace.calls.length) await recordUsage(trace.calls, request.source);
      // Its visitor had this session forgotten while it was being written (visitor plan V14):
      // it is not logged. Its spend, an aggregate, still counts, and a leak still alerts.
      if (!wasForgotten(request.sessionHash)) {
        await logAnswer({
          id: messageId,
          sessionHash: request.sessionHash,
          locale,
          language,
          source: request.source,
          route: loggedRoute(details.answering?.answerOnly ?? false, route, escalated !== null),
          routeReason: route.reason,
          question: request.question,
          answer: outcome.text,
          citedIds: outcome.citedIds,
          toolCalls: record.toolCalls.map((c) => c.name),
          model: outcome.model,
          attempts: trace.attempts,
          ttftMs: trace.firstTokenAt === null ? null : trace.firstTokenAt - trace.startedAt,
          totalMs: Date.now() - trace.startedAt,
          tokens: details.tokens,
          usd: outcome.usd,
          finishReason: outcome.finishReason,
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
      }
    } catch (error) {
      console.error("[ask] could not record the answer", error);
      captureError(error, { phase: "ask-log" });
    }
    // A piece of the instructions or a secret was written for a visitor: the
    // owner hears of it at once, even when the answer could not be logged.
    if (request.source === "terminal" && outcome.checks.flags.includes("leak")) {
      const reached = leakReached({
        text: outcome.text,
        question: request.question,
        toolText: details.toolText,
        secrets: details.secrets,
      });
      await raiseAlert(leakAlert(messageId, leaks.kinds(), reached)).catch((error: unknown) =>
        console.error("[ask] leak alert not written", error),
      );
    }
  };

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
        traceDetails(),
      ),
      checks: checkAnswer({
        text,
        locale,
        language,
        droppedCitations: dropped,
        toolNames: record.toolCalls.map((c) => c.name),
        finishReason,
        steps: agentCalls ?? trace.calls.length,
        maxRounds: config.agentMaxRounds,
        degraded: usedFallback(trace, answeringChain()),
        guarded: [...leaks.kinds()],
        question: request.question,
        toolText,
        secrets,
        repaired: repair !== null,
        // The figures it states, checked against what it cited, as read (visitor plan V7).
        citedTexts: [...cited].map((id) => corpus.byId.get(id)?.text ?? ""),
        careful: route.sensitive !== undefined,
      }),
      usd,
      searchCalls,
      escalation: escalated?.reason ?? null,
      // Never logged: the eval runner keeps an excerpt of a failed case's (evals/run.ts).
      reasoning: record.reasoning?.trim() || null,
      repair,
      handoff,
    };

    if (record.error && !(record.error instanceof AllModelsFailedError) && ending !== "aborted") {
      console.error("[ask] answer failed", record.error);
      captureError(record.error, { phase: "ask" });
    }
    await persistOutcome(outcome, { answering, tokens, toolText, secrets });
    resolveDone(outcome);
  };

  let reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
  const stream = new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        reader ??= ui.getReader();
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
