import { beforeEach, describe, expect, it } from "vitest";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

import {
  apiError,
  drain,
  failing,
  failsMidStream,
  mockEntry,
  scripted,
  silent,
  textTurn,
} from "../../test/ask-models.js";
import { breakerSnapshot, recordFailure, resetBreakers, tryAcquire } from "./circuit.js";
import {
  AllModelsFailedError,
  classifyError,
  createFallbackModel,
  newTrace,
  type FallbackOptions,
} from "./fallback.js";

const call: LanguageModelV4CallOptions = {
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

const withTools: LanguageModelV4CallOptions = {
  ...call,
  tools: [{ type: "function", name: "search", description: "", inputSchema: { type: "object" } }],
};

function fallback(entries: FallbackOptions["entries"], extra: Partial<FallbackOptions> = {}) {
  const trace = newTrace();
  const model = createFallbackModel({
    entries,
    trace,
    firstChunkTimeoutMs: 200,
    requestTimeoutMs: 2_000,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    estimateTokens: () => 100,
    sleep: async () => undefined,
    ...extra,
  });
  return { model, trace };
}

function textOf(parts: LanguageModelV4StreamPart[]): string {
  return parts.map((p) => (p.type === "text-delta" ? p.delta : "")).join("");
}

beforeEach(() => resetBreakers());

describe("createFallbackModel", () => {
  it("streams from the first model when it answers", async () => {
    const a = scripted([textTurn("Hello", " world")]);
    const b = scripted([textTurn("unused")]);
    const { model, trace } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)]);

    const parts = await drain((await model.doStream(call)).stream);

    expect(textOf(parts)).toBe("Hello world");
    expect(b.calls).toHaveLength(0);
    expect(trace.attempts.map((x) => x.outcome)).toEqual(["ok"]);
    expect(trace.calls[0]).toMatchObject({ model: "a", finishReason: "stop" });
    expect(trace.calls[0]!.usage?.inputTokens.total).toBe(100);
    expect(trace.firstTokenAt).not.toBeNull();
  });

  it("moves on after a rate limit and keeps that model out until its pause ends", async () => {
    const a = failing(apiError(429, { "retry-after": "120" }));
    const b = scripted([textTurn("from b")]);
    const first = fallback([mockEntry("a", a.model), mockEntry("b", b.model)]);

    expect(textOf(await drain((await first.model.doStream(call)).stream))).toBe("from b");
    expect(first.trace.attempts.map((x) => `${x.model}:${x.outcome}`)).toEqual([
      "a:rate-limited",
      "b:ok",
    ]);
    expect(a.calls).toHaveLength(1);

    // The breaker is open: the next answer skips `a` without calling it.
    const second = fallback([mockEntry("a", a.model), mockEntry("b", b.model)]);
    await drain((await second.model.doStream(call)).stream);
    expect(a.calls).toHaveLength(1);
    expect(second.trace.attempts[0]).toMatchObject({ model: "a", outcome: "skipped-open" });

    const [state] = breakerSnapshot(["a"]);
    expect(state!.state).toBe("open");
    // Retry-After (120 s) outlasts the default pause.
    expect(Date.parse(state!.openUntil!) - Date.now()).toBeGreaterThan(100_000);
  });

  it("can honor Retry-After once for an eval before opening the breaker", async () => {
    const recovered = scripted([textTurn("recovered")]);
    let calls = 0;
    const flaky = new MockLanguageModelV4({
      modelId: "flaky-rate-limit",
      doStream: async (options) => {
        calls++;
        if (calls === 1) throw apiError(429, { "retry-after": "120" });
        return recovered.model.doStream(options);
      },
    });
    const waits: number[] = [];
    const { model, trace } = fallback([mockEntry("a", flaky)], {
      rateLimitRetry: { maxRetries: 1, defaultDelayMs: 60_000, maxDelayMs: 30_000 },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(textOf(await drain((await model.doStream(call)).stream))).toBe("recovered");
    expect(calls).toBe(2);
    expect(waits).toEqual([30_000]);
    expect(trace.attempts.map((x) => x.outcome)).toEqual(["ok"]);
    expect(breakerSnapshot(["a"])[0]!.state).toBe("closed");
  });

  it("stops a rate-limit wait as soon as the request is aborted", async () => {
    const controller = new AbortController();
    const a = failing(apiError(429));
    const b = scripted([textTurn("unused")]);
    let waitStarted!: () => void;
    const waiting = new Promise<void>((resolve) => {
      waitStarted = resolve;
    });
    const cancelled = new Error("eval cancelled");
    const { model } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)], {
      rateLimitRetry: { maxRetries: 1, defaultDelayMs: 60_000, maxDelayMs: 60_000 },
      sleep: (_ms, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          waitStarted();
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });

    const request = model.doStream({ ...call, abortSignal: controller.signal });
    await waiting;
    controller.abort(cancelled);
    const outcome = await Promise.race([
      Promise.resolve(request).catch((error: unknown) => error),
      new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 25)),
    ]);

    expect(outcome).toBe(cancelled);
    expect(b.calls).toHaveLength(0);
  });

  it("retries a server error on the same model before falling back", async () => {
    const a = failing(apiError(503));
    const b = scripted([textTurn("ok")]);
    const { model, trace } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)], {
      maxRetries: 2,
    });

    await drain((await model.doStream(call)).stream);

    expect(a.calls).toHaveLength(3);
    expect(trace.attempts.map((x) => x.outcome)).toEqual(["server-error", "ok"]);
  });

  it("does not retry a client error such as a bad key", async () => {
    const a = failing(apiError(403));
    const b = scripted([textTurn("ok")]);
    const { model, trace } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)], {
      maxRetries: 3,
    });

    await drain((await model.doStream(call)).stream);

    expect(a.calls).toHaveLength(1);
    expect(trace.attempts[0]!.outcome).toBe("client-error");
  });

  it("falls back when a model sends nothing before the first-chunk timeout", async () => {
    const a = silent();
    const b = scripted([textTurn("fast")]);
    const { model, trace } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)], {
      firstChunkTimeoutMs: 30,
    });

    const parts = await drain((await model.doStream(call)).stream);

    expect(textOf(parts)).toBe("fast");
    expect(trace.attempts.map((x) => x.outcome)).toEqual(["timeout", "ok"]);
    // The silent request was aborted, not left running.
    expect(a.calls[0]!.abortSignal?.aborted).toBe(true);
  });

  it("never switches once text has streamed: the stream ends with an error instead", async () => {
    const a = failsMidStream(apiError(500));
    const b = scripted([textTurn("second answer")]);
    const { model, trace } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)]);

    const parts = await drain((await model.doStream(call)).stream);

    expect(textOf(parts)).toBe("Partial ");
    expect(parts.at(-1)?.type).toBe("error");
    expect(b.calls).toHaveLength(0);
    expect(trace.calls.map((c) => c.model)).toEqual(["a"]);
  });

  it("skips a model without tools when tools are needed, unless an answer-only rebuild is given", async () => {
    const small = scripted([textTurn("summary answer")]);
    const skipped = fallback([mockEntry("glm", small.model, { tools: false })]);
    await expect(skipped.model.doStream(withTools)).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(skipped.trace.attempts[0]!.outcome).toBe("skipped-capability");

    const rebuilt = fallback([mockEntry("glm", small.model, { tools: false })], {
      answerOnly: (options) => ({ ...options, tools: undefined }),
    });
    await drain((await rebuilt.model.doStream(withTools)).stream);
    expect(small.calls.at(-1)!.tools).toBeUndefined();
    expect(rebuilt.trace.calls[0]!.answerOnly).toBe(true);
  });

  it("skips a model whose context window cannot hold the prompt", async () => {
    const tiny = scripted([textTurn("x")]);
    const big = scripted([textTurn("fits")]);
    const { model, trace } = fallback(
      [mockEntry("tiny", tiny.model, { contextWindow: 1_000 }), mockEntry("big", big.model)],
      { estimateTokens: () => 5_000 },
    );

    await drain((await model.doStream(call)).stream);

    expect(tiny.calls).toHaveLength(0);
    expect(trace.attempts.map((x) => x.outcome)).toEqual(["skipped-context", "ok"]);
  });

  it("reports every attempt when no model can answer", async () => {
    const { model } = fallback([
      mockEntry("a", failing(apiError(500)).model),
      mockEntry("b", failing(new TypeError("fetch failed")).model),
      mockEntry("c", scripted([textTurn("x")]).model, { available: false }),
    ]);

    const error = await model.doStream(call).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AllModelsFailedError);
    expect((error as AllModelsFailedError).attempts.map((a) => `${a.model}:${a.outcome}`)).toEqual([
      "a:server-error",
      "b:network",
      "c:skipped-missing",
    ]);
  });

  it("stops at once when the visitor leaves, without trying the next model", async () => {
    const controller = new AbortController();
    const a = failing(apiError(500));
    const b = scripted([textTurn("unused")]);
    const { model } = fallback([mockEntry("a", a.model), mockEntry("b", b.model)]);
    controller.abort();

    await expect(model.doStream({ ...call, abortSignal: controller.signal })).rejects.toBeDefined();
    expect(b.calls).toHaveLength(0);
  });

  it("merges the entry's provider options over the request's", async () => {
    const a = scripted([textTurn("x")]);
    const entry = {
      ...mockEntry("a", a.model),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
    };
    const { model } = fallback([entry]);
    await drain(
      (await model.doStream({ ...call, providerOptions: { google: { labels: { app: "x" } } } }))
        .stream,
    );
    expect(a.calls[0]!.providerOptions).toEqual({
      google: { labels: { app: "x" }, thinkingConfig: { thinkingLevel: "low" } },
    });
  });
});

describe("circuit breaker", () => {
  it("opens after three failures and lets one probe through once the pause is over", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 2; i++) recordFailure("m", { error: "boom" }, t0);
    expect(tryAcquire("m", t0)).toBe(true);
    recordFailure("m", { error: "boom" }, t0);
    expect(tryAcquire("m", t0 + 1_000)).toBe(false);

    const later = t0 + 61_000;
    expect(tryAcquire("m", later)).toBe(true);
    // Only one probe at a time.
    expect(tryAcquire("m", later)).toBe(false);
    // A failed probe opens it again at once.
    recordFailure("m", { error: "still down" }, later);
    expect(tryAcquire("m", later + 1_000)).toBe(false);
  });
});

describe("classifyError", () => {
  it("formats standard Error instances", () => {
    expect(classifyError(new Error("custom error"))).toMatchObject({
      outcome: "network",
      message: "custom error",
    });
  });

  it("formats string errors", () => {
    expect(classifyError("network disconnect")).toMatchObject({
      outcome: "network",
      message: "network disconnect",
    });
  });

  it("formats objects with a message property", () => {
    expect(classifyError({ message: "failed to connect", code: 503 })).toMatchObject({
      outcome: "network",
      message: "failed to connect",
    });
  });

  it("JSON serializes plain objects without a message property", () => {
    expect(classifyError({ code: "ECONNRESET", detail: "socket hang up" })).toMatchObject({
      outcome: "network",
      message: JSON.stringify({ code: "ECONNRESET", detail: "socket hang up" }),
    });
  });

  it("handles primitives and nullish values safely", () => {
    expect(classifyError(500)).toMatchObject({
      outcome: "network",
      message: "500",
    });
    expect(classifyError(null)).toMatchObject({
      outcome: "network",
      message: "Unknown error",
    });
    expect(classifyError(undefined)).toMatchObject({
      outcome: "network",
      message: "Unknown error",
    });
  });
});
