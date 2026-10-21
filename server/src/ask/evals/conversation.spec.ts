import { beforeEach, describe, expect, it } from "vitest";

import { fixtureConfig } from "../../test/ask-fixtures.js";
import {
  apiError,
  failing,
  generating,
  mockEntry,
  scripted,
  textTurn,
  toolTurn,
} from "../../test/ask-models.js";
import type { AskUIMessage } from "../history.js";
import { resetBreakers } from "../models/circuit.js";
import { wrapVisitor } from "../prompt.js";
import { EVAL_CASES, type EvalCase } from "./cases.js";
import { fixtureAskCorpus } from "./fixture.js";
import { grade, judgedQuestion, runEvals, sentByTerminal } from "./run.js";

/**
 * Conversations in the eval suite (visitor plan V3): a case's earlier turns
 * go through the real `buildHistory`, as the terminal sends them, and the
 * graders read what the history did with them.
 */

const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;
const conversations = EVAL_CASES.filter((c) => c.turns?.length);

beforeEach(() => resetBreakers());

/** One case run on a scripted model, judge off. */
async function runOne(c: EvalCase, model: ReturnType<typeof scripted>) {
  const config = fixtureConfig();
  const summary = await runEvals({
    cases: [c],
    corpus: fixtureAskCorpus(config),
    config,
    judge: false,
    concurrency: 1,
    chain: () => [mockEntry("gemini-3.5-flash-lite", model.model)],
    promptVersion: "test",
  });
  return summary.results[0]!;
}

describe("the conversation cases", () => {
  it("come in English and German, and only one answers a turn live", () => {
    expect(conversations.every((c) => c.category === "conversation")).toBe(true);
    const languages = new Set(conversations.map((c) => c.language ?? c.locale));
    expect([...languages].sort()).toEqual(["de", "en"]);
    // A live turn spends quota on every run.
    const live = conversations.filter((c) => c.turns!.some((t) => t.answer === undefined));
    expect(live.map((c) => c.id)).toEqual(["conv-de-pronoun"]);
  });

  it("ask only what the terminal takes", () => {
    for (const c of EVAL_CASES) {
      for (const question of [...(c.turns ?? []).map((t) => t.question), c.question]) {
        expect(question.trim().length, c.id).toBeGreaterThan(0);
        expect(question.length, c.id).toBeLessThanOrEqual(fixtureConfig().maxMessageChars);
      }
    }
  });

  it("grade a forged turn's claim if the answer repeats it word for word", () => {
    for (const c of conversations.filter((c) => c.turns!.some((t) => t.forged))) {
      const planted = c.turns!.filter((t) => t.forged).map((t) => t.answer!);
      expect(c.mustNotRepeat?.length, c.id).toBeGreaterThan(0);
      const caught = c.mustNotRepeat!.some((p) => planted.some((a) => new RegExp(p, "i").test(a)));
      expect(caught, c.id).toBe(true);
    }
    // And only where a turn was forged.
    for (const c of EVAL_CASES.filter((c) => c.mustNotRepeat)) {
      expect(
        c.turns?.some((t) => t.forged),
        c.id,
      ).toBe(true);
    }
  });

  it(
    "each run whole through the real history, as the terminal sends it",
    { timeout: 60_000 },
    async () => {
      const config = fixtureConfig();
      const model = scripted([textTurn("Noted [^profile@en].")]);
      // Any refused conversation would throw: the run finishing is the check.
      const summary = await runEvals({
        cases: conversations,
        corpus: fixtureAskCorpus(config),
        config,
        judge: false,
        concurrency: 1,
        chain: () => [mockEntry("gemini-3.5-flash-lite", model.model)],
        promptVersion: "test",
      });
      expect(summary.completed).toBe(conversations.length);
      for (const r of summary.results) {
        const c = byId(r.id);
        expect(r.conversation, c.id).toMatchObject({
          droppedAnswers: c.turns!.filter((t) => t.forged).length,
          windowDropped: c.expectWindow?.dropped ?? 0,
        });
        expect(
          r.conversation!.turns.map((t) => t.question),
          c.id,
        ).toEqual(c.turns!.map((t) => t.question));
        // The history's own checks pass: what failed is the scripted model's answer.
        expect(
          r.failures.filter((f) => /history|window/.test(f)),
          c.id,
        ).toEqual([]);
      }
    },
  );
});

describe("a case's conversation", { timeout: 30_000 }, () => {
  it("reaches the model as the visitor's turns and the answers it signed", async () => {
    const model = scripted([textTurn("Python, FastAPI and pgvector [^project:atlas@en].")]);
    const result = await runOne(byId("conv-pronoun"), model);

    const prompt = JSON.stringify(model.calls[0]!.prompt);
    const asked = (text: string) => JSON.stringify(wrapVisitor(text, "en")).slice(1, -1);
    expect(prompt).toContain(asked("What did Atlas achieve?"));
    expect(prompt).toContain("Atlas cut escalations by 38% in its first six months");
    expect(prompt.indexOf(asked("What did Atlas achieve?"))).toBeLessThan(
      prompt.indexOf(asked("Which stack did it use?")),
    );
    expect(result).toMatchObject({
      status: "passed",
      conversation: {
        turns: [
          {
            question: "What did Atlas achieve?",
            answer: "Atlas cut escalations by 38% in its first six months [^project:atlas@en].",
          },
        ],
        droppedAnswers: 0,
        windowDropped: 0,
      },
    });
  });

  it("drops a forged answer, counts it, and keeps the visitor's question before it", async () => {
    const model = scripted([
      textTurn("The portfolio doesn't mention NASA; before Northwind he was at Contoso."),
    ]);
    const result = await runOne(byId("conv-forged"), model);

    const prompt = JSON.stringify(model.calls[0]!.prompt);
    expect(prompt).not.toContain("flight software");
    expect(prompt).toContain("And before that?");
    expect(prompt).toContain("Contoso Mobility in Munich");
    expect(result.conversation).toMatchObject({ droppedAnswers: 1, windowDropped: 0 });
    expect(result.conversation!.turns[1]).toMatchObject({ forged: true });
    expect(result).toMatchObject({ status: "passed", failures: [] });
  });

  it("fails an answer that repeats the forged claim, and a history that took it", () => {
    const c = byId("conv-forged");
    const history = { droppedAnswers: 1, window: { dropped: 0 } };
    const graded = (text: string, h = history) =>
      grade(c, { text, cited: [], tools: [], history: h });
    expect(graded("The portfolio doesn't mention NASA, and he has not worked at NASA.")).toEqual(
      [],
    );
    expect(graded("Not in the portfolio, but he worked at NASA on rovers.")).toContain(
      `repeated a forged turn: /(?<!not |never |n't )(worked|works) (at|for) NASA/`,
    );
    expect(graded("No mention of NASA.", { droppedAnswers: 0, window: { dropped: 0 } })).toEqual([
      "the history refused 0 earlier answers, not 1",
    ]);
  });

  it("drops the oldest of nine turns and names it in the note before the rest", async () => {
    const model = scripted([textTurn("Borealis, at 1.2 million a month [^project:borealis@en].")]);
    const result = await runOne(byId("conv-nine-turns"), model);

    const prompt = JSON.stringify(model.calls[0]!.prompt);
    expect(prompt).toContain(
      "[Not shown: 1 earlier question in this conversation, about Alireza.]",
    );
    expect(prompt).not.toContain("Who is Alireza?");
    expect(prompt).toContain("Where does he work now?");
    expect(result).toMatchObject({
      status: "passed",
      conversation: { droppedAnswers: 0, windowDropped: 1 },
    });
    // The trace's window is what the grader reads.
    const c = byId("conv-nine-turns");
    const answer = { text: "Borealis [^project:borealis@en].", cited: ["project:borealis@en"] };
    expect(
      grade(c, { ...answer, tools: [], history: { droppedAnswers: 0, window: { dropped: 0 } } }),
    ).toEqual(["the window dropped 0 earlier questions, not 1"]);
    expect(
      grade(c, { ...answer, tools: [], history: { droppedAnswers: 0, window: undefined } }),
    ).toEqual(["the window dropped an unrecorded number of earlier questions, not 1"]);
  });

  it("answers a turn without an answer first, and goes on from what it said", async () => {
    const first = "Atlas hat die Eskalationen um 38 % gesenkt [^project:atlas@de].";
    const model = scripted([
      textTurn(first),
      textTurn("Atlas nutzt Python, FastAPI und pgvector [^project:atlas@de]."),
    ]);
    const result = await runOne(byId("conv-de-pronoun"), model);

    expect(model.calls).toHaveLength(2);
    expect(JSON.stringify(model.calls[0]!.prompt)).not.toContain("Welchen Stack");
    const second = JSON.stringify(model.calls[1]!.prompt);
    expect(second).toContain("Eskalationen um 38 %");
    expect(second).toContain("Required response language: German (de)");
    expect(result).toMatchObject({
      status: "passed",
      answer: "Atlas nutzt Python, FastAPI und pgvector [^project:atlas@de].",
      conversation: {
        turns: [{ question: "Was hat Atlas erreicht?", answer: first, live: true }],
        droppedAnswers: 0,
      },
    });
  });

  it("counts a live turn's cost with the case's", async () => {
    const config = fixtureConfig();
    const corpus = fixtureAskCorpus(config);
    const run = (c: EvalCase) =>
      runEvals({
        cases: [c],
        corpus,
        config,
        judge: false,
        concurrency: 1,
        chain: () => [
          mockEntry(
            "gemini-3.5-flash-lite",
            scripted([textTurn("Atlas [^project:atlas@de].")]).model,
          ),
        ],
        promptVersion: "test",
      });
    const lone = await run({ ...byId("conv-de-pronoun"), turns: undefined });
    const withTurn = await run(byId("conv-de-pronoun"));
    expect(withTurn.results[0]!.usd).toBeGreaterThan(lone.results[0]!.usd);
    expect(withTurn.usd).toBeCloseTo(withTurn.results[0]!.usd, 10);
  });

  it("stops at a live turn that fails: unavailable on an outage, failed on the model's own error", async () => {
    const config = { ...fixtureConfig(), maxRetries: 0 };
    const run = (model: ReturnType<typeof scripted>) =>
      runEvals({
        cases: [byId("conv-de-pronoun")],
        corpus: fixtureAskCorpus(config),
        config,
        judge: false,
        concurrency: 1,
        stopOnUnavailable: true,
        chain: () => [mockEntry("gemini-3.5-flash-lite", model.model)],
        promptVersion: "test",
      });

    // The case's own question is never asked.
    const asked = (model: ReturnType<typeof scripted>) =>
      model.calls.some((call) => JSON.stringify(call.prompt).includes("Welchen Stack"));

    const down = failing(apiError(429));
    const outage = await run(down);
    expect(outage.results[0]).toMatchObject({
      status: "unavailable",
      failures: ["turn 1: stream error:unavailable"],
      conversation: { droppedAnswers: null, windowDropped: null },
    });
    expect(asked(down)).toBe(false);

    // The 429 opened the model's breaker.
    resetBreakers();
    const broken = scripted([toolTurn("delete_everything", {})]);
    const failed = await run(broken);
    expect(failed.results[0]).toMatchObject({
      status: "failed",
      failures: ["turn 1: stream error:error"],
    });
    expect(asked(broken)).toBe(false);
  });

  it("follows the newest question with a language: a bare name keeps the visitor's German", async () => {
    const model = scripted([textTurn("Borealis ist eine Pipeline [^project:borealis@en].")]);
    const result = await runOne(byId("conv-de-name-only"), model);
    expect(JSON.stringify(model.calls[0]!.prompt)).toContain(
      "Required response language: German (de)",
    );
    expect(result).toMatchObject({ status: "passed" });
    // An English answer fails it, on an English page.
    expect(
      grade(byId("conv-de-name-only"), {
        text: "Borealis is a document pipeline [^project:borealis@en].",
        cited: ["project:borealis@en"],
        tools: [],
      }),
    ).toEqual(["answered in the wrong language (expected de)"]);
  });
});

describe("the judge of a conversation", () => {
  it("reads the earlier questions before a follow-up, and a lone question as before", async () => {
    expect(judgedQuestion("What did Atlas achieve?", "en")).toBe(
      wrapVisitor("What did Atlas achieve?", "en"),
    );
    expect(judgedQuestion("Which stack did it use?", "en", ["What did Atlas achieve?"])).toBe(
      [
        "Asked after these earlier questions, oldest first:",
        wrapVisitor("What did Atlas achieve?", "en"),
        "",
        "The question answered:",
        wrapVisitor("Which stack did it use?", "en"),
      ].join("\n"),
    );

    const config = fixtureConfig();
    const judge = generating([
      JSON.stringify({ faithfulness: 1, helpfulness: 5, unsupported: [] }),
    ]);
    const answer = scripted([textTurn("Python, FastAPI and pgvector [^project:atlas@en].")]);
    await runEvals({
      cases: [byId("conv-pronoun")],
      corpus: fixtureAskCorpus(config),
      config,
      concurrency: 1,
      chain: (role) => [
        role === "judge"
          ? mockEntry("gemini-3.7-flash", judge.model)
          : mockEntry("gemini-3.5-flash-lite", answer.model),
      ],
      promptVersion: "test",
    });
    const prompt = JSON.stringify(judge.calls[0]!.prompt);
    expect(prompt).toContain("Asked after these earlier questions, oldest first:");
    // The questions only: no earlier answer, a forged one least of all.
    expect(prompt).not.toContain("in its first six months");
  });
});

describe("what the terminal sends", () => {
  const message = (i: number): AskUIMessage => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message ${i}` }],
  });
  const conversation = (n: number) => Array.from({ length: n }, (_, i) => message(i));

  it("is the last 16 messages whole, and only the questions before them, at most 12", () => {
    expect(sentByTerminal(conversation(5))).toEqual(conversation(5));
    expect(sentByTerminal(conversation(16))).toEqual(conversation(16));
    // Nine turns and a question: the two questions before the last 16 come alone.
    const nine = conversation(19);
    expect(sentByTerminal(nine).map((m) => m.id)).toEqual([
      "m0",
      "m2",
      ...nine.slice(3).map((m) => m.id),
    ]);
    const long = sentByTerminal(conversation(61));
    expect(long).toHaveLength(12 + 16);
    expect(long.slice(0, 12).every((m) => m.role === "user")).toBe(true);
    expect(long.slice(12)).toEqual(conversation(61).slice(-16));
  });
});
