import { randomBytes } from "node:crypto";
import { generateText, Output } from "ai";
import { z } from "zod";

import { streamAnswer } from "../agent.js";
import type { AskConfig, ProviderName } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import {
  createFallbackModel,
  newTrace,
  type Attempt,
  type ModelCall,
  type RateLimitRetryOptions,
} from "../models/fallback.js";
import type { ChainRole, ModelEntry } from "../models/registry.js";
import { wrapVisitor } from "../prompt.js";
import { routeQuestion } from "../router.js";
import { countTokens } from "../tokens.js";
import { summarizeCalls } from "../usage.js";
import type { EvalCase, EvalCategory } from "./cases.js";

/**
 * Runs the eval cases live: each question goes through the real agent (same
 * prompt, tools, citation check and fallback chain as visitors get), then
 * deterministic checks, then — for answerable questions — an LLM judge that
 * scores faithfulness to the cited documents and helpfulness.
 *
 * Nothing is written to the database: the caller decides whether to count the
 * cost (the admin page does; the CLI does not, its database is production).
 */

export interface CaseResult {
  id: string;
  category: EvalCategory;
  status: "passed" | "failed" | "unavailable";
  passed: boolean;
  failures: string[];
  answer: string;
  cited: string[];
  invented: string[];
  tools: { name: string; input: unknown }[];
  model: string | null;
  ttftMs: number | null;
  totalMs: number;
  usd: number;
  judge: { faithfulness: number; helpfulness: number; unsupported: string[] } | null;
  attempts: Attempt[];
}

export interface EvalCategorySummary {
  cases: number;
  completed: number;
  passed: number;
  unavailable: number;
}

export interface EvalSummary {
  promptVersion: string;
  corpus: string;
  cases: number;
  completed: number;
  passed: number;
  unavailable: number;
  remaining: number;
  incomplete: boolean;
  passRate: number;
  byCategory: Record<string, EvalCategorySummary>;
  usd: number;
  p50TtftMs: number | null;
  p95TotalMs: number | null;
  results: CaseResult[];
}

export interface EvalPacingOptions {
  requestsPerMinute: Record<ProviderName, number>;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Conservative defaults that fit the configured providers' free tiers. */
export const FREE_TIER_EVAL_PACING: EvalPacingOptions = {
  requestsPerMinute: { gemini: 5, openrouter: 20 },
};

/** A free-tier RPM limit is usually temporary; wait once, but never indefinitely. */
export const FREE_TIER_RATE_LIMIT_RETRY: RateLimitRetryOptions = {
  maxRetries: 1,
  defaultDelayMs: 60_000,
  maxDelayMs: 60_000,
};

export interface EvalOptions {
  cases: EvalCase[];
  corpus: AskCorpus;
  config: AskConfig;
  chain: (role: ChainRole) => ModelEntry[];
  concurrency?: number;
  judge?: boolean;
  pacing?: EvalPacingOptions;
  rateLimitRetry?: RateLimitRetryOptions;
  stopOnUnavailable?: boolean;
  /** Cancels both answer and judge work, including pacing and retry waits. */
  abortSignal?: AbortSignal;
  onResult?: (result: CaseResult) => void;
  promptVersion: string;
  /** Every model call made (answers and judge), for the caller's accounting. */
  calls?: ModelCall[];
  /** Internal hooks populated by runEvals and shared by answer and judge calls. */
  beforeModelCall?: (entry: ModelEntry, signal?: AbortSignal) => Promise<void>;
  timeoutExtraMs?: number;
}

const GERMAN_WORDS = new Set([
  "und",
  "der",
  "die",
  "das",
  "ist",
  "nicht",
  "mit",
  "für",
  "auf",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "eines",
  "sein",
  "seine",
  "seinem",
  "seinen",
  "seiner",
  "seines",
  "hat",
  "wurde",
  "sich",
  "auch",
  "über",
  "bei",
  "lebt",
  "deutschland",
  "arbeitet",
  "verwendet",
  "projekt",
  "standort",
  "verfügbarkeit",
]);

const ENGLISH_WORDS = new Set([
  "and",
  "the",
  "is",
  "not",
  "with",
  "for",
  "on",
  "a",
  "an",
  "his",
  "has",
  "was",
  "also",
  "about",
  "at",
  "of",
  "to",
  "lives",
  "works",
  "uses",
  "main",
  "includes",
  "backend",
  "stack",
  "project",
]);

export function detectLanguage(text: string): "en" | "de" | null {
  let de = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (GERMAN_WORDS.has(word)) de++;
    if (ENGLISH_WORDS.has(word)) en++;
  }
  if (de === en) return null;
  return de > en ? "de" : "en";
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function checkCitations(c: EvalCase, cited: string[], failures: string[]): void {
  for (const id of c.mustCite ?? []) {
    if (!cited.includes(id)) failures.push(`did not cite ${id}`);
  }
  if (c.citeAny && !c.citeAny.some((id) => cited.includes(id))) {
    failures.push(`cited none of ${c.citeAny.join(", ")}`);
  }
}

function expectedLanguage(c: EvalCase): string | null {
  if (c.language) return c.language;
  if (["fact", "multi-hop", "german"].includes(c.category)) return c.locale;
  return null;
}

function checkProse(c: EvalCase, prose: string, failures: string[]): void {
  for (const pattern of c.mustInclude ?? []) {
    if (!new RegExp(pattern, "i").test(prose)) failures.push(`missing /${pattern}/`);
  }
  for (const pattern of c.mustNotInclude ?? []) {
    if (new RegExp(pattern, "im").test(prose)) failures.push(`contains /${pattern}/`);
  }
  const language = expectedLanguage(c);
  const detected = detectLanguage(prose);
  if (language && detected && detected !== language) {
    failures.push(`answered in the wrong language (expected ${language})`);
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error("aborted"));
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    function done() {
      cleanup();
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Serializes physical provider calls and spaces their start times. */
function createModelCallGate(
  pacing: EvalPacingOptions,
): (entry: ModelEntry, signal?: AbortSignal) => Promise<void> {
  const now = pacing.now ?? Date.now;
  const sleep = pacing.sleep ?? abortableSleep;
  const nextAt = new Map<ProviderName, number>();
  const tails = new Map<ProviderName, Promise<void>>();

  return async (entry, signal) => {
    const provider = entry.provider;
    const rpm = Math.max(1, pacing.requestsPerMinute[provider]);
    const intervalMs = Math.ceil(60_000 / rpm);
    const previous = tails.get(provider) ?? Promise.resolve();
    const turn = previous
      .catch(() => undefined)
      .then(async () => {
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        const waitMs = Math.max(0, (nextAt.get(provider) ?? now()) - now());
        if (waitMs > 0) await sleep(waitMs, signal);
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        nextAt.set(provider, now() + intervalMs);
      });
    tails.set(provider, turn);
    try {
      await turn;
    } finally {
      if (tails.get(provider) === turn) tails.delete(provider);
    }
  };
}

function timeoutAllowance(options: EvalOptions, chainLength: number): number {
  const rpm = options.pacing ? Object.values(options.pacing.requestsPerMinute) : [];
  const slowestInterval = rpm.length
    ? Math.max(...rpm.map((value) => 60_000 / Math.max(1, value)))
    : 0;
  const rateLimitRetries = Math.max(0, options.rateLimitRetry?.maxRetries ?? 0);
  const attemptsPerEntry = 1 + Math.max(0, options.config.maxRetries);
  const pacedAttempts =
    Math.max(1, options.config.agentMaxRounds) * Math.max(1, chainLength) * attemptsPerEntry +
    rateLimitRetries;
  return Math.ceil(
    slowestInterval * pacedAttempts + rateLimitRetries * (options.rateLimitRetry?.maxDelayMs ?? 0),
  );
}

function checkToolInput(
  toolName: string,
  expectedInput: Record<string, unknown>,
  actualInput: unknown,
  failures: string[],
): void {
  const actual = actualInput as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(expectedInput)) {
    if (actual?.[key] !== value) {
      failures.push(`${toolName}.${key} was ${JSON.stringify(actual?.[key])}`);
    }
  }
}

function checkTools(
  c: EvalCase,
  tools: { name: string; input: unknown }[],
  failures: string[],
): void {
  if (c.expectTool) {
    const call = tools.find((t) => t.name === c.expectTool!.name);
    if (!call) {
      failures.push(`did not call ${c.expectTool.name}`);
    } else if (c.expectTool.input) {
      checkToolInput(c.expectTool.name, c.expectTool.input, call.input, failures);
    }
  }
  for (const name of c.forbidTools ?? []) {
    if (tools.some((t) => t.name === name)) failures.push(`called ${name}`);
  }
}

/** The deterministic checks; the judge adds its own failures. */
export function grade(
  c: EvalCase,
  answer: { text: string; cited: string[]; tools: { name: string; input: unknown }[] },
): string[] {
  const failures: string[] = [];
  // Citation markers are not prose: patterns check the words.
  const prose = answer.text.replace(/\[\^[^\]]+\]/g, "");

  if (!prose.trim() && !c.expectTool) failures.push("empty answer");
  checkCitations(c, answer.cited, failures);
  checkProse(c, prose, failures);
  checkTools(c, answer.tools, failures);

  return failures;
}

const judgeSchema = z.object({
  faithfulness: z
    .number()
    .min(0)
    .max(1)
    .describe("Share of factual claims supported by the documents (1 = all)"),
  helpfulness: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe("How well the answer serves the question (5 = fully)"),
  unsupported: z
    .array(z.string())
    .max(10)
    .describe("Claims the documents do not support, quoted briefly"),
});

async function judgeAnswer(
  options: EvalOptions,
  c: EvalCase,
  text: string,
  cited: string[],
  acquireRateLimitRetry?: () => boolean,
): Promise<{ value: CaseResult["judge"]; unavailable: boolean; attempts: Attempt[] }> {
  const chain = options.chain("judge");
  if (!chain.length) return { value: null, unavailable: true, attempts: [] };
  const trace = newTrace();
  const model = createFallbackModel({
    entries: chain,
    trace,
    firstChunkTimeoutMs: options.config.firstChunkTimeoutMs * 2,
    requestTimeoutMs: options.config.requestTimeoutMs,
    maxRetries: options.config.maxRetries,
    retryBaseDelayMs: options.config.retryBaseDelayMs,
    retryMaxDelayMs: options.config.retryMaxDelayMs,
    rateLimitRetry: options.rateLimitRetry,
    acquireRateLimitRetry,
    beforeAttempt: options.beforeModelCall,
    estimateTokens: (o) => countTokens(JSON.stringify(o.prompt)),
  });
  const documents = (cited.length ? cited : ["profile@en"])
    .map((id) => options.corpus.byId.get(id))
    .filter((d) => d !== undefined)
    .map((d) => `[${d.id}]\n${d.text}`)
    .join("\n\n");
  try {
    const result = await generateText({
      model,
      abortSignal: options.abortSignal,
      maxRetries: 0,
      temperature: 0,
      output: Output.object({ schema: judgeSchema }),
      instructions:
        "You grade an AI assistant's answer about a person's portfolio. A claim counts as supported only if the documents state it. Statements that something is not in the portfolio, polite declines and offers to contact are not factual claims. Be strict.",
      prompt: `Question:\n${c.question}\n\nAnswer:\n${text}\n\nDocuments the answer cited:\n${documents}`,
    });
    return { value: result.output, unavailable: false, attempts: trace.attempts };
  } catch (error) {
    console.warn(`[eval] judge failed for ${c.id}`, (error as Error).message);
    return { value: null, unavailable: true, attempts: trace.attempts };
  } finally {
    options.calls?.push(...trace.calls);
  }
}

async function applyJudge(
  options: EvalOptions,
  c: EvalCase,
  text: string,
  citedIds: string[],
  failures: string[],
  attempts: Attempt[],
  acquireRateLimitRetry?: () => boolean,
): Promise<{ judge: CaseResult["judge"]; unavailable: boolean }> {
  if (options.judge === false || !c.judge || !text.trim()) {
    return { judge: null, unavailable: false };
  }
  const judged = await judgeAnswer(options, c, text, citedIds, acquireRateLimitRetry);
  attempts.push(...judged.attempts);
  if (judged.unavailable) {
    failures.unshift("judge unavailable");
    return { judge: judged.value, unavailable: true };
  }
  const judge = judged.value;
  if (judge) {
    if (judge.faithfulness < 0.8) {
      failures.push(
        `faithfulness ${judge.faithfulness.toFixed(2)}: ${judge.unsupported.join("; ")}`,
      );
    }
    if (judge.helpfulness < 3) failures.push(`helpfulness ${judge.helpfulness}`);
  }
  return { judge, unavailable: false };
}

function createRetryAcquirer(retry?: EvalOptions["rateLimitRetry"]): (() => boolean) | undefined {
  if (!retry) return undefined;
  let remaining = Math.max(0, retry.maxRetries ?? 0);
  return () => {
    if (remaining <= 0) return false;
    remaining--;
    return true;
  };
}

function createCaseAbortSignal(
  configTimeoutMs: number,
  timeoutExtraMs: number,
  signal?: AbortSignal,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(configTimeoutMs + timeoutExtraMs + 5_000);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function drainStream(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* keep reading */
  }
}

function collectCaseFailures(
  c: EvalCase,
  outcome: { text: string; finishReason: string; citedIds: string[]; droppedCitations: string[] },
  operationalFailure: boolean,
  tools: { name: string; input: unknown }[],
): string[] {
  if (operationalFailure) return [`stream ${outcome.finishReason}`];
  const failures = grade(c, { text: outcome.text, cited: outcome.citedIds, tools });
  if (outcome.droppedCitations.length) {
    failures.push(`invented citations: ${outcome.droppedCitations.join(", ")}`);
  }
  return failures;
}

async function runCase(options: EvalOptions, c: EvalCase): Promise<CaseResult> {
  const { config, corpus } = options;
  const route = routeQuestion(c.question, {
    forceDeep: false,
    deepAllowed: true,
    projectNames: corpus.projects.map((p) => p.name),
  });
  const chain = options.chain(route.route);
  const timeoutExtraMs = options.timeoutExtraMs ?? timeoutAllowance(options, chain.length);
  const acquireRateLimitRetry = createRetryAcquirer(options.rateLimitRetry);
  const abortSignal = createCaseAbortSignal(
    config.streamTimeoutMs,
    timeoutExtraMs,
    options.abortSignal,
  );
  const sessionId = `eval-${randomBytes(9).toString("base64url")}`;
  const { stream, done } = streamAnswer({
    messages: [{ role: "user", content: wrapVisitor(c.question, c.locale) }],
    question: c.question,
    locale: c.locale,
    sessionId,
    sessionHash: sessionId,
    source: "eval",
    route,
    corpus,
    config,
    chain,
    abortSignal,
    rateLimitRetry: options.rateLimitRetry,
    acquireRateLimitRetry,
    beforeModelCall: options.beforeModelCall,
    timeoutExtraMs,
    persist: false,
  });

  await drainStream(stream);
  const outcome = await done;
  options.calls?.push(...outcome.trace.calls);

  const tools = outcome.toolCalls.map((t) => ({ name: t.name, input: t.input }));
  const operationalFailure =
    outcome.finishReason.startsWith("error") || outcome.finishReason === "aborted";
  const failures = collectCaseFailures(c, outcome, operationalFailure, tools);

  const attempts = [...outcome.trace.attempts];
  let judge: CaseResult["judge"] = null;
  let unavailable = operationalFailure;
  if (!unavailable) {
    const judged = await applyJudge(
      options,
      c,
      outcome.text,
      outcome.citedIds,
      failures,
      attempts,
      acquireRateLimitRetry,
    );
    judge = judged.judge;
    unavailable = judged.unavailable;
  }

  const trace = outcome.trace;
  let status: CaseResult["status"] = "passed";
  if (unavailable) {
    status = "unavailable";
  } else if (failures.length > 0) {
    status = "failed";
  }
  return {
    id: c.id,
    category: c.category,
    status,
    passed: status === "passed",
    failures,
    answer: outcome.text,
    cited: outcome.citedIds,
    invented: outcome.droppedCitations,
    tools,
    model: outcome.model,
    ttftMs: trace.firstTokenAt === null ? null : trace.firstTokenAt - trace.startedAt,
    totalMs: Date.now() - trace.startedAt,
    usd: outcome.usd,
    judge,
    attempts,
  };
}

export async function runEvals(input: EvalOptions): Promise<EvalSummary> {
  const options: EvalOptions = {
    ...input,
    calls: input.calls ?? [],
    beforeModelCall: input.pacing ? createModelCallGate(input.pacing) : undefined,
  };
  const queue = [...options.cases];
  const results: CaseResult[] = [];
  let halted = false;
  const workerCount = options.stopOnUnavailable ? 1 : Math.max(1, options.concurrency ?? 3);
  const workers = Array.from({ length: workerCount }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (halted) break;
      const result = await runCase(options, c);
      results.push(result);
      options.onResult?.(result);
      if (options.stopOnUnavailable && result.status === "unavailable") {
        halted = true;
        queue.length = 0;
        break;
      }
    }
  });
  await Promise.all(workers);

  const order = new Map(options.cases.map((c, i) => [c.id, i]));
  results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const byCategory: EvalSummary["byCategory"] = {};
  for (const c of options.cases) {
    const row = (byCategory[c.category] ??= {
      cases: 0,
      completed: 0,
      passed: 0,
      unavailable: 0,
    });
    row.cases++;
  }
  for (const r of results) {
    const row = byCategory[r.category]!;
    if (r.status === "unavailable") {
      row.unavailable++;
      continue;
    }
    row.completed++;
    if (r.passed) row.passed++;
  }
  const passed = results.filter((r) => r.passed).length;
  const completed = results.filter((r) => r.status !== "unavailable").length;
  const unavailable = results.length - completed;
  const remaining = options.cases.length - results.length;
  const incomplete = unavailable > 0 || remaining > 0;
  const completedResults = results.filter((r) => r.status !== "unavailable");
  return {
    promptVersion: options.promptVersion,
    corpus: options.corpus.key,
    cases: options.cases.length,
    completed,
    passed,
    unavailable,
    remaining,
    incomplete,
    passRate: completed ? passed / completed : 0,
    byCategory,
    usd: summarizeCalls(options.calls ?? []).usd,
    p50TtftMs: percentile(
      completedResults.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs])),
      0.5,
    ),
    p95TotalMs: percentile(
      completedResults.map((r) => r.totalMs),
      0.95,
    ),
    results,
  };
}
