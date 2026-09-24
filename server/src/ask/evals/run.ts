import { randomBytes } from "node:crypto";
import { generateText, Output } from "ai";
import { z } from "zod";

import { streamAnswer } from "../agent.js";
import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import { createFallbackModel, newTrace, type ModelCall } from "../models/fallback.js";
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
}

export interface EvalSummary {
  promptVersion: string;
  corpus: string;
  cases: number;
  passed: number;
  passRate: number;
  byCategory: Record<string, { cases: number; passed: number }>;
  usd: number;
  p50TtftMs: number | null;
  p95TotalMs: number | null;
  results: CaseResult[];
}

export interface EvalOptions {
  cases: EvalCase[];
  corpus: AskCorpus;
  config: AskConfig;
  chain: (role: ChainRole) => ModelEntry[];
  concurrency?: number;
  judge?: boolean;
  onResult?: (result: CaseResult) => void;
  promptVersion: string;
  /** Every model call made (answers and judge), for the caller's accounting. */
  calls?: ModelCall[];
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
]);

export function detectLanguage(text: string): "en" | "de" {
  let de = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (GERMAN_WORDS.has(word)) de++;
    if (ENGLISH_WORDS.has(word)) en++;
  }
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
  if (language && prose.trim() && detectLanguage(prose) !== language) {
    failures.push(`answered in the wrong language (expected ${language})`);
  }
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
): Promise<CaseResult["judge"]> {
  const chain = options.chain("judge");
  if (!chain.length) return null;
  const trace = newTrace();
  const model = createFallbackModel({
    entries: chain,
    trace,
    firstChunkTimeoutMs: options.config.firstChunkTimeoutMs * 2,
    requestTimeoutMs: options.config.requestTimeoutMs,
    maxRetries: options.config.maxRetries,
    retryBaseDelayMs: options.config.retryBaseDelayMs,
    retryMaxDelayMs: options.config.retryMaxDelayMs,
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
      maxRetries: 0,
      temperature: 0,
      output: Output.object({ schema: judgeSchema }),
      instructions:
        "You grade an AI assistant's answer about a person's portfolio. A claim counts as supported only if the documents state it. Statements that something is not in the portfolio, polite declines and offers to contact are not factual claims. Be strict.",
      prompt: `Question:\n${c.question}\n\nAnswer:\n${text}\n\nDocuments the answer cited:\n${documents}`,
    });
    return result.output;
  } catch (error) {
    console.warn(`[eval] judge failed for ${c.id}`, (error as Error).message);
    return null;
  } finally {
    options.calls?.push(...trace.calls);
  }
}

async function runCase(options: EvalOptions, c: EvalCase): Promise<CaseResult> {
  const { config, corpus } = options;
  const route = routeQuestion(c.question, {
    forceDeep: false,
    deepAllowed: true,
    projectNames: corpus.projects.map((p) => p.name),
  });
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
    chain: options.chain(route.route),
    abortSignal: AbortSignal.timeout(config.streamTimeoutMs + 5_000),
    persist: false,
  });
  // Drain: the outcome is complete once the stream is.
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    /* keep reading */
  }
  const outcome = await done;
  options.calls?.push(...outcome.trace.calls);

  const tools = outcome.toolCalls.map((t) => ({ name: t.name, input: t.input }));
  const failures = grade(c, { text: outcome.text, cited: outcome.citedIds, tools });
  if (outcome.finishReason.startsWith("error")) failures.unshift(`stream ${outcome.finishReason}`);
  if (outcome.droppedCitations.length) {
    failures.push(`invented citations: ${outcome.droppedCitations.join(", ")}`);
  }

  let judge: CaseResult["judge"] = null;
  if (options.judge !== false && c.judge && outcome.text.trim()) {
    judge = await judgeAnswer(options, c, outcome.text, outcome.citedIds);
    if (judge && judge.faithfulness < 0.8) {
      failures.push(
        `faithfulness ${judge.faithfulness.toFixed(2)}: ${judge.unsupported.join("; ")}`,
      );
    }
    if (judge && judge.helpfulness < 3) failures.push(`helpfulness ${judge.helpfulness}`);
  }

  const trace = outcome.trace;
  return {
    id: c.id,
    category: c.category,
    passed: failures.length === 0,
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
  };
}

export async function runEvals(input: EvalOptions): Promise<EvalSummary> {
  const options = { ...input, calls: input.calls ?? [] };
  const queue = [...options.cases];
  const results: CaseResult[] = [];
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 3) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const result = await runCase(options, c);
      results.push(result);
      options.onResult?.(result);
    }
  });
  await Promise.all(workers);

  const order = new Map(options.cases.map((c, i) => [c.id, i]));
  results.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const byCategory: EvalSummary["byCategory"] = {};
  for (const r of results) {
    const row = (byCategory[r.category] ??= { cases: 0, passed: 0 });
    row.cases++;
    if (r.passed) row.passed++;
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    promptVersion: options.promptVersion,
    corpus: options.corpus.key,
    cases: results.length,
    passed,
    passRate: results.length ? passed / results.length : 0,
    byCategory,
    usd: summarizeCalls(options.calls).usd,
    p50TtftMs: percentile(
      results.flatMap((r) => (r.ttftMs === null ? [] : [r.ttftMs])),
      0.5,
    ),
    p95TotalMs: percentile(
      results.map((r) => r.totalMs),
      0.95,
    ),
    results,
  };
}
