import {
  APICallError,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
  type LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { ModelEntry } from "../ask/models/registry.js";

/**
 * Scripted models for the assistant's tests: no network, deterministic.
 * Each `turns` item answers one call (an agent step); the last repeats.
 */

export function usage(input = 100, output = 20, cached = 0): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: input,
      noCache: input - cached,
      cacheRead: cached,
      cacheWrite: undefined,
    },
    outputTokens: { total: output, text: output, reasoning: undefined },
  };
}

export function finish(
  reason: "stop" | "tool-calls" | "content-filter" = "stop",
  u: LanguageModelV4Usage = usage(),
): LanguageModelV4StreamPart {
  return { type: "finish", finishReason: { unified: reason, raw: reason }, usage: u };
}

/** A plain text answer, split into the given deltas. */
export function textTurn(...deltas: string[]): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
    { type: "text-end", id: "t1" },
    finish("stop"),
  ];
}

/** One tool call, then the model waits for the result (next turn). */
export function toolTurn(
  toolName: string,
  input: unknown,
  id = "call-1",
): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
    finish("tool-calls"),
  ];
}

/** Text and a tool call in the same step (how follow-ups arrive). */
export function textAndToolTurn(
  text: string,
  toolName: string,
  input: unknown,
): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    { type: "tool-call", toolCallId: "call-f", toolName, input: JSON.stringify(input) },
    finish("tool-calls"),
  ];
}

export interface ScriptedModel {
  model: MockLanguageModelV4;
  calls: LanguageModelV4CallOptions[];
}

export function scripted(turns: LanguageModelV4StreamPart[][], modelId = "mock"): ScriptedModel {
  let i = 0;
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doStream: async (options) => {
      calls.push(options);
      const chunks = turns[Math.min(i++, turns.length - 1)]!;
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: null }) };
    },
  });
  return { model, calls };
}

export function apiError(statusCode: number, headers: Record<string, string> = {}): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://provider.test",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    isRetryable: statusCode >= 500,
  });
}

/** Fails every call before streaming anything. */
export function failing(error: unknown, modelId = "failing"): ScriptedModel {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doStream: async (options) => {
      calls.push(options);
      throw error;
    },
  });
  return { model, calls };
}

/** Accepts the call and then never sends a thing (until aborted). */
export function silent(modelId = "silent"): ScriptedModel {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doStream: async (options) => {
      calls.push(options);
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          pull: () => new Promise(() => {}),
        }),
      };
    },
  });
  return { model, calls };
}

/** Streams some text, then fails. */
export function failsMidStream(error: unknown, modelId = "flaky"): ScriptedModel {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doStream: async (options) => {
      calls.push(options);
      return {
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Partial " },
            { type: "error", error },
          ],
          chunkDelayInMs: null,
        }),
      };
    },
  });
  return { model, calls };
}

export function mockEntry(
  id: string,
  model: MockLanguageModelV4,
  caps: Partial<Pick<ModelEntry, "tools" | "contextWindow" | "available">> = {},
): ModelEntry {
  return {
    id,
    provider: id.includes("/") ? "openrouter" : "gemini",
    model,
    contextWindow: caps.contextWindow ?? 1_000_000,
    tools: caps.tools ?? true,
    structuredOutputs: true,
    caching: true,
    available: caps.available ?? true,
  };
}

/** Everything the stream produced, in order. */
export async function drain<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

/** Non-streaming calls (copilot, insights, the judge): each call returns the next text. */
export function generating(texts: string[], modelId = "gen"): ScriptedModel {
  let i = 0;
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doGenerate: async (options) => {
      calls.push(options);
      const text = texts[Math.min(i++, texts.length - 1)]!;
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(50, 10),
        warnings: [],
      };
    },
  });
  return { model, calls };
}
