import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  apiError,
  failing,
  generating,
  mockEntry,
  scripted,
  textTurn,
  toolTurn,
} from "../../test/ask-models.js";
import { fixtureConfig } from "../../test/ask-fixtures.js";
import { resetBreakers } from "../models/circuit.js";
import { EVAL_CASES } from "./cases.js";
import { fixtureAskCorpus } from "./fixture.js";
import { detectLanguage, grade, runEvals } from "./run.js";

const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

beforeEach(() => resetBreakers());

describe("eval graders", () => {
  it("passes a cited, correct answer and names what a wrong one misses", () => {
    const c = byId("fact-atlas-impact");
    expect(
      grade(c, {
        text: "Atlas cut escalations by 38% [^project:atlas@en].",
        cited: ["project:atlas@en"],
        tools: [],
      }),
    ).toEqual([]);
    expect(grade(c, { text: "Atlas was a success.", cited: [], tools: [] })).toEqual([
      "did not cite project:atlas@en",
      "missing /38/",
    ]);
  });

  it("catches a leaked system prompt and a wrong language", () => {
    expect(
      grade(byId("inj-ignore"), {
        text: "Sure: You are the assistant built into the portfolio…",
        cited: [],
        tools: [],
      }),
    ).toContain("contains /You are the assistant built into/");
    expect(
      grade(byId("de-location"), {
        text: "He lives in Berlin [^profile@en].",
        cited: ["profile@en"],
        tools: [],
      }),
    ).toContain("answered in the wrong language (expected de)");
  });

  it("checks the tool and its input", () => {
    const c = byId("tool-open-atlas");
    expect(
      grade(c, {
        text: "",
        cited: [],
        tools: [{ name: "navigate", input: { to: "/en/work/atlas" } }],
      }),
    ).toEqual([]);
    expect(
      grade(c, { text: "", cited: [], tools: [{ name: "navigate", input: { to: "/en" } }] }),
    ).toEqual(['navigate.to was "/en"']);
  });

  it("tells German from English", () => {
    expect(detectLanguage("Er lebt in Berlin und arbeitet mit Python.")).toBe("de");
    expect(detectLanguage("He lives in Berlin and works with Python.")).toBe("en");
    expect(detectLanguage("Alireza lebt in Berlin, Deutschland.")).toBe("de");
    expect(detectLanguage("His main backend stack includes Python.")).toBe("en");
    expect(detectLanguage("Berlin")).toBeNull();
  });

  it("accepts the production answers that plainly say information is absent", () => {
    expect(
      grade(byId("unknown-salary"), {
        text: "Alireza's portfolio does not specify his salary expectations. Please contact him.",
        cited: [],
        tools: [],
      }),
    ).toEqual([]);
    expect(
      grade(byId("unknown-gpa"), {
        text: "The provided documents do not contain information about Alireza's GPA.",
        cited: [],
        tools: [],
      }),
    ).toEqual([]);
    expect(
      grade(byId("halluc-nebula"), {
        text: "Alireza's portfolio does not contain a project named Nebula.",
        cited: [],
        tools: [],
      }),
    ).toEqual([]);
  });

  it("still rejects fabricated details after a valid absence statement", () => {
    expect(
      grade(byId("unknown-salary"), {
        text: "The portfolio does not specify it; contact him. He expects 120k.",
        cited: [],
        tools: [],
      }),
    ).toContain(String.raw`contains /\d{2,3}k\b/`);
    expect(
      grade(byId("halluc-nebula"), {
        text: "The portfolio does not contain it, but Nebula improved accuracy.",
        cited: [],
        tools: [],
      }),
    ).toContain("contains /nebula (achieved|reduced|improved|increased)/");
  });

  it("does not flag a short, valid German production answer as English", () => {
    expect(
      grade(byId("de-location"), {
        text: "Alireza lebt in Berlin, Deutschland [^profile@de].",
        cited: ["profile@de"],
        tools: [],
      }),
    ).toEqual([]);

    expect(
      grade(byId("de-english-question"), {
        text: "Alireza's main backend stack includes Python and PostgreSQL [^skills@en].",
        cited: ["skills@en"],
        tools: [],
      }),
    ).toContain("answered in the wrong language (expected de)");
  });

  it("every case refers only to ids the fixture has", () => {
    const corpus = fixtureAskCorpus(fixtureConfig());
    for (const c of EVAL_CASES) {
      for (const id of [...(c.mustCite ?? []), ...(c.citeAny ?? [])]) {
        expect(corpus.byId.has(id), `${c.id}: ${id}`).toBe(true);
      }
    }
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(40);
  });
});

describe("runEvals", () => {
  it("runs the real agent over scripted models and scores the results", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    // One scripted model per case, in order (concurrency 1, judge off).
    const models = [
      scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en] [^invented@en].")]),
      scripted([toolTurn("navigate", { to: "/en/work/atlas" }), textTurn("Opening it.")]),
    ];
    let next = 0;
    const summary = await runEvals({
      cases: [byId("fact-atlas-impact"), byId("tool-open-atlas")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      chain: () => [mockEntry("gemini-3.5-flash-lite", models[next++]!.model)],
      promptVersion: "test",
    });
    expect(summary.cases).toBe(2);
    expect(summary.results.find((r) => r.id === "tool-open-atlas")).toMatchObject({
      passed: true,
      tools: [{ name: "navigate", input: { to: "/en/work/atlas" } }],
    });
    const atlas = summary.results.find((r) => r.id === "fact-atlas-impact")!;
    expect(atlas.cited).toEqual(["project:atlas@en"]);
    expect(atlas.invented).toEqual(["invented@en"]);
    expect(atlas.failures).toEqual(["invented citations: invented@en"]);
    expect(summary.usd).toBeGreaterThan(0);
  });

  it("paces answer and judge calls through one shared provider gate", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const answer = scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);
    const judge = generating([
      JSON.stringify({ faithfulness: 1, helpfulness: 5, unsupported: [] }),
    ]);
    let now = 1_000;
    const waits: number[] = [];

    const summary = await runEvals({
      cases: [byId("fact-atlas-impact")],
      corpus,
      config,
      concurrency: 1,
      chain: (role) => [
        role === "judge"
          ? mockEntry("gemini-3.7-flash", judge.model)
          : mockEntry("gemini-3.5-flash-lite", answer.model),
      ],
      pacing: {
        requestsPerMinute: { gemini: 5, openrouter: 20 },
        now: () => now,
        sleep: async (ms: number) => {
          waits.push(ms);
          now += ms;
        },
      },
      promptVersion: "test",
    });

    expect(summary.passed).toBe(1);
    expect(waits).toEqual([12_000]);
  });

  it("puts the required locale in both full and answer-only system prompts", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const full = scripted([textTurn("Python.")]);
    await runEvals({
      cases: [byId("de-english-question")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      chain: () => [mockEntry("gemini-full", full.model)],
      promptVersion: "test",
    });

    const fullPrompt = JSON.stringify(full.calls[0]!.prompt);
    expect(fullPrompt).toContain("Required response language: German (de)");
    expect(fullPrompt).toContain("even when the question or source documents are in English");

    const compact = scripted([textTurn("Python.")]);
    await runEvals({
      cases: [byId("de-english-question")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      chain: () => [mockEntry("answer-only", compact.model, { tools: false })],
      promptVersion: "test",
    });

    const compactPrompt = JSON.stringify(compact.calls[0]!.prompt);
    expect(compactPrompt).toContain("Required response language: German (de)");
    expect(compactPrompt).toContain("even when the question or source documents are in English");
  });

  it("marks a judged case unavailable when the judge exhausts its quota", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const answer = scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);
    const judge = new MockLanguageModelV4({
      modelId: "judge-quota-test",
      doGenerate: async () => {
        throw apiError(429);
      },
    });

    const summary = await runEvals({
      cases: [byId("fact-atlas-impact")],
      corpus,
      config: { ...config, maxRetries: 0 },
      concurrency: 1,
      stopOnUnavailable: true,
      chain: (role) => [
        role === "judge"
          ? mockEntry("gemini-judge-quota-test", judge)
          : mockEntry("gemini-answer-test", answer.model),
      ],
      promptVersion: "test",
    });

    expect(summary).toMatchObject({
      completed: 0,
      passed: 0,
      unavailable: 1,
      incomplete: true,
    });
    expect(summary.results[0]).toMatchObject({
      status: "unavailable",
      failures: ["judge unavailable"],
    });
  });

  it("propagates eval cancellation into a running judge call", async () => {
    const config = fixtureConfig({ requestTimeoutMs: 200 });
    const corpus = fixtureAskCorpus(config);
    const answer = scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);
    let judgeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      judgeStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    const judge = new MockLanguageModelV4({
      modelId: "judge-cancellation-test",
      doGenerate: async (call) => {
        providerSignal = call.abortSignal;
        judgeStarted();
        return new Promise((_resolve, reject) => {
          const onAbort = () => reject(call.abortSignal?.reason ?? new Error("aborted"));
          if (call.abortSignal?.aborted) onAbort();
          else call.abortSignal?.addEventListener("abort", onAbort, { once: true });
        });
      },
    });
    const controller = new AbortController();
    const cancelled = new Error("eval cancelled");

    const run = runEvals({
      cases: [byId("fact-atlas-impact")],
      corpus,
      config,
      concurrency: 1,
      abortSignal: controller.signal,
      chain: (role) => [
        role === "judge"
          ? mockEntry("gemini-judge-cancellation-test", judge)
          : mockEntry("gemini-answer-cancellation-test", answer.model),
      ],
      promptVersion: "test",
    });
    await started;
    controller.abort(cancelled);
    const outcome = await Promise.race([
      run,
      new Promise<"still waiting">((resolve) => setTimeout(() => resolve("still waiting"), 30)),
    ]);

    expect(outcome).not.toBe("still waiting");
    expect(providerSignal?.aborted).toBe(true);
    if (outcome !== "still waiting") {
      expect(outcome).toMatchObject({ incomplete: true, unavailable: 1 });
    }
  });

  it("spends at most one rate-limit retry across a whole case", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const first = failing(apiError(429));
    const second = failing(apiError(429));

    const summary = await runEvals({
      cases: [byId("inj-repeat")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      stopOnUnavailable: true,
      rateLimitRetry: { maxRetries: 1, defaultDelayMs: 0, maxDelayMs: 0 },
      chain: () => [
        mockEntry("gemini-case-budget-a", first.model),
        mockEntry("gemini-case-budget-b", second.model),
      ],
      promptVersion: "test",
    });

    expect(summary.incomplete).toBe(true);
    expect(first.calls.length + second.calls.length).toBe(3);
  });

  it("reserves enough timeout for paced fallback and retry calls", async () => {
    const config = fixtureConfig({ agentMaxRounds: 1, streamTimeoutMs: 100 });
    const corpus = fixtureAskCorpus(config);
    const limited = failing(apiError(429));
    const recovered = scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);

    const summary = await runEvals({
      cases: [byId("fact-atlas-impact")],
      corpus,
      config,
      judge: false,
      concurrency: 1,
      rateLimitRetry: { maxRetries: 1, defaultDelayMs: 0, maxDelayMs: 0 },
      pacing: { requestsPerMinute: { gemini: 600, openrouter: 600 } },
      chain: () => [
        mockEntry("gemini-paced-fallback-a", limited.model),
        mockEntry("gemini-paced-fallback-b", recovered.model),
      ],
      promptVersion: "test",
    });

    expect(summary).toMatchObject({ completed: 1, passed: 1, incomplete: false });
    expect(limited.calls).toHaveLength(2);
    expect(recovered.calls).toHaveLength(1);
  });

  it("stops after provider exhaustion and reports an incomplete run without semantic noise", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const unavailable = failing(apiError(429));

    const summary = await runEvals({
      cases: [byId("inj-repeat"), byId("tool-open-atlas")],
      corpus,
      config: { ...config, maxRetries: 0 },
      judge: false,
      concurrency: 1,
      stopOnUnavailable: true,
      chain: () => [mockEntry("gemini-quota-test", unavailable.model)],
      promptVersion: "test",
    });

    expect(summary).toMatchObject({
      cases: 2,
      completed: 0,
      passed: 0,
      unavailable: 1,
      remaining: 1,
      incomplete: true,
    });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({
      id: "inj-repeat",
      status: "unavailable",
      failures: ["stream error:unavailable"],
    });
  });
});
