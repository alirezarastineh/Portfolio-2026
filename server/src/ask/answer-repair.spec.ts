import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream, simulateReadableStream, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";

import type { Locale } from "../content/schema.js";
import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import {
  apiError,
  drain,
  finish,
  mockEntry,
  scripted,
  textTurn,
  toolTurn,
} from "../test/ask-models.js";
import { streamAnswer, type AnswerMetadata } from "./agent.js";
import { lookupsOf, mergeInOrder, repairMessages } from "./answer-repair.js";
import { messageText, verifyAnswer, type AskUIMessage } from "./history.js";
import { resetBreakers } from "./models/circuit.js";
import { closingLine, REPAIR_LEAD, REPAIR_LINE, wrapVisitor } from "./prompt.js";
import { FETCH_CLIP } from "./tool-defs.js";

/**
 * No answer without words (visitor plan V5): an answer that ends with none
 * gets one more call on its own chain, tools off, and the words join the same
 * message; if that call has none either, a fixed line closes it. Scripted
 * models, through the real agent.
 */

const SESSION = "repair-words-session-01";

/** A step that ends with nothing at all. */
const EMPTY: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }, finish("stop")];

/** Fails the calls listed (1-based), answers the rest from the script. */
function failingOn(failing: number[], turns: LanguageModelV4StreamPart[][], modelId = "mixed") {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId,
    doStream: (options) => {
      calls.push(options);
      if (failing.includes(calls.length)) return Promise.reject(apiError(400));
      const chunks = turns[Math.min(calls.length - 1, turns.length - 1)]!;
      return Promise.resolve({ stream: simulateReadableStream({ chunks, chunkDelayInMs: null }) });
    },
  });
  return { model, calls };
}

async function answer(
  model: { model: MockLanguageModelV4; calls: LanguageModelV4CallOptions[] },
  options: { question?: string; language?: Locale } = {},
) {
  const question = options.question ?? "My email is jane@example.com, please send him my CV.";
  const language = options.language ?? "en";
  const config = fixtureConfig();
  const { stream, done } = streamAnswer({
    messages: [{ role: "user", content: wrapVisitor(question, language) }],
    question,
    locale: language,
    language,
    sessionId: SESSION,
    sessionHash: "repair-words",
    source: "eval",
    route: { route: "lite", reason: "test" },
    corpus: fixtureCorpus(config),
    config,
    chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
    abortSignal: new AbortController().signal,
    persist: false,
  });
  const chunks = (await drain(stream)) as UIMessageChunk[];
  return { chunks, outcome: await done, calls: model.calls };
}

/** The message as the browser builds it from the chunks. */
async function browserMessage(chunks: UIMessageChunk[]): Promise<AskUIMessage> {
  let last: AskUIMessage | undefined;
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  for await (const message of readUIMessageStream<AskUIMessage>({ stream })) last = message;
  return last!;
}

/** The finish's metadata; the stream has exactly one finish and no separate metadata chunk. */
function finishMetadata(chunks: UIMessageChunk[]): AnswerMetadata {
  const finishes = chunks.filter((c) => c.type === "finish");
  expect(finishes).toHaveLength(1);
  expect(chunks.filter((c) => c.type === "message-metadata")).toHaveLength(0);
  return (finishes[0] as { messageMetadata: AnswerMetadata }).messageMetadata;
}

/** The text of the last call's last visitor turn: the repair's request. */
function sentText(call: LanguageModelV4CallOptions): string {
  return JSON.stringify(call.prompt.at(-1));
}

/** Whether a call was the repair: the only one told the repair line. */
const isRepair = (call: LanguageModelV4CallOptions) => sentText(call).includes(REPAIR_LEAD);

describe("an answer without words gets one repair (visitor plan V5)", () => {
  beforeEach(() => resetBreakers());

  it("a hand-off first: the repair's words come, then the offer, in one signed message", async () => {
    const summary = "Jane would like to send Alireza her CV.";
    const words = "I can pass your request to Alireza: confirm below and the contact form opens.";
    const { chunks, outcome, calls } = await answer(
      scripted([toolTurn("handoff_contact", { summary }), textTurn(words)]),
    );

    expect(calls).toHaveLength(2);
    expect(outcome.text).toBe(words);
    expect(outcome.toolCalls.map((c) => c.name)).toEqual(["handoff_contact"]);
    expect(outcome.repair).toEqual({ reason: "handoff-without-words", by: "model" });
    expect(outcome.steps?.repair).toEqual(outcome.repair);
    expect(outcome.checks.flags).toContain("repaired");
    expect(outcome.checks.flags).not.toContain("empty");
    expect(outcome.finishReason).toBe("stop");

    // The repair's request: tools off, the answer's own instructions, what the hand-off
    // returned, then the line, last.
    const repair = calls[1]!;
    expect(repair.tools ?? []).toHaveLength(0);
    expect(repair.prompt[0]).toEqual(calls[0]!.prompt[0]);
    const sent = sentText(repair);
    expect(sent).toContain("handoff_contact");
    expect(sent).toContain(summary);
    expect(sent.indexOf("awaitingConfirmation")).toBeLessThan(
      sent.indexOf("No tools are available"),
    );

    // The offer's part reached the browser before the words, and the words before the finish.
    const types = chunks.map((c) => c.type);
    expect(types.indexOf("tool-input-available")).toBeLessThan(types.indexOf("text-delta"));
    expect(types.at(-1)).toBe("finish");
    const metadata = finishMetadata(chunks);
    expect(metadata.finishReason).toBe("stop");
    const message = await browserMessage(chunks);
    expect(messageText(message)).toBe(words);
    expect(verifyAnswer(SESSION, outcome.messageId, messageText(message), metadata.sig!)).toBe(
      true,
    );
  });

  it("follow-ups only, then an empty step: repaired, no words being the reason", async () => {
    const { outcome, calls } = await answer(
      scripted([
        toolTurn("suggest_followups", { items: ["What does he build?"] }),
        EMPTY,
        textTurn("He is based in Berlin [^profile@en]."),
      ]),
      { question: "Where is he based?" },
    );
    expect(calls).toHaveLength(3);
    expect(outcome.repair).toEqual({ reason: "no-words", by: "model" });
    expect(outcome.text).toBe("He is based in Berlin [^profile@en].");
    expect(outcome.citedIds).toEqual(["profile@en"]);
    // The repair's call is not a round: three calls are not every round.
    expect(outcome.checks.flags).toEqual(["repaired"]);
  });

  it("empty twice: the fixed line closes it in the answer's language, with no third call", async () => {
    for (const language of ["en", "de"] as const) {
      resetBreakers();
      const { chunks, outcome, calls } = await answer(scripted([EMPTY]), {
        question: language === "de" ? "Wo wohnt er genau?" : "Where does he live exactly?",
        language,
      });
      expect(calls).toHaveLength(2);
      expect(outcome.text).toBe(closingLine(language));
      expect(outcome.repair).toEqual({ reason: "no-words", by: "fixed-line" });
      expect(outcome.finishReason).toBe("stop");
      expect(outcome.checks.flags).toEqual(["repaired"]);
      const metadata = finishMetadata(chunks);
      const message = await browserMessage(chunks);
      expect(verifyAnswer(SESSION, outcome.messageId, messageText(message), metadata.sig!)).toBe(
        true,
      );
    }
  });

  it("a content filter or an error is never repaired", async () => {
    const filtered = await answer(
      scripted([[{ type: "stream-start", warnings: [] }, finish("content-filter")]]),
    );
    expect(filtered.calls).toHaveLength(1);
    expect(filtered.outcome.repair).toBeNull();
    expect(filtered.outcome.checks.flags).toContain("blocked");
    expect(filtered.outcome.checks.flags).not.toContain("repaired");

    resetBreakers();
    // A tool no name can mean: the agent tries each round, then the answer fails.
    const failed = await answer(scripted([toolTurn("delete_everything", {})]));
    expect(failed.outcome.finishReason).toBe("error:error");
    expect(failed.calls.some(isRepair)).toBe(false);
    expect(failed.outcome.repair).toBeNull();
  });

  it("an answer with words is never repaired, nor one that opened a page", async () => {
    const words = await answer(scripted([textTurn("He is based in Berlin [^profile@en].")]));
    expect(words.calls).toHaveLength(1);
    expect(words.outcome.repair).toBeNull();

    resetBreakers();
    const opened = await answer(scripted([toolTurn("navigate", { to: "/en" }), EMPTY]), {
      question: "Take me home.",
    });
    expect(opened.outcome.toolCalls.map((c) => c.name)).toEqual(["navigate"]);
    expect(opened.outcome.repair).toBeNull();
  });

  it("the repair line is instructions: an answer copying it has the copy removed", async () => {
    const { outcome } = await answer(scripted([textTurn(`Sure. ${REPAIR_LINE}`)]), {
      question: "Where is he based?",
    });
    expect(outcome.text).not.toContain("as the instructions above say");
    expect(outcome.checks.flags).toContain("leak");
  });

  it("an invented citation in the repair is removed and counted, as in any answer", async () => {
    const { outcome } = await answer(
      scripted([EMPTY, textTurn("He is based in Berlin [^profile@en][^project:nebula@en].")]),
      { question: "Where is he based?" },
    );
    expect(outcome.text).toBe("He is based in Berlin [^profile@en].");
    expect(outcome.droppedCitations).toEqual(["project:nebula@en"]);
    expect(outcome.checks.flags).toEqual(expect.arrayContaining(["repaired", "invented-citation"]));
  });

  it("a repair that fails ends with the fixed line, never an error", async () => {
    const { chunks, outcome, calls } = await answer(failingOn([2], [EMPTY]), {
      question: "Where is he based?",
    });
    expect(calls).toHaveLength(2);
    expect(chunks.some((c) => c.type === "error")).toBe(false);
    expect(outcome.text).toBe(closingLine("en"));
    expect(outcome.finishReason).toBe("stop");
    expect(outcome.repair).toEqual({ reason: "no-words", by: "fixed-line" });
    // The failed attempt stays in the trace: a step no model could answer.
    expect(outcome.steps?.steps.at(-1)?.model).toBeNull();
  });

  it("an echo of the question loses its fence and counts as no words: repaired", async () => {
    const question = "Where is he based?";
    const { chunks, outcome, calls } = await answer(
      scripted([
        // The fence split across chunks, as a model may stream it.
        [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: '<visitor locale="en">Where is ' },
          { type: "text-delta", id: "t1", delta: "he based?</visi" },
          { type: "text-delta", id: "t1", delta: "tor>" },
          { type: "text-end", id: "t1" },
          finish("stop"),
        ],
        textTurn("He is based in Berlin [^profile@en]."),
      ]),
      { question },
    );
    expect(calls).toHaveLength(2);
    expect(outcome.repair).toEqual({ reason: "echo", by: "model" });
    expect(outcome.text).toBe(`${question}\n\nHe is based in Berlin [^profile@en].`);
    expect(JSON.stringify(chunks)).not.toContain("visitor");
  });

  it("a stub of a word, uncited and unfinished, is repaired; a short sentence is not", async () => {
    const stub = await answer(
      scripted([textTurn("Alire"), textTurn("He is based in Berlin [^profile@en].")]),
      { question: "Where is he based?" },
    );
    expect(stub.outcome.repair).toEqual({ reason: "stub", by: "model" });
    expect(stub.outcome.text).toBe("Alire\n\nHe is based in Berlin [^profile@en].");

    resetBreakers();
    const short = await answer(scripted([textTurn("Berlin.")]), { question: "Where is he based?" });
    expect(short.calls).toHaveLength(1);
    expect(short.outcome.repair).toBeNull();
  });

  it("the repair's text parts never reuse the agent's ids: each word is signed once", async () => {
    // The agent's part "t1" holds only an invented marker (removed); the repair's is "t1" too.
    const { chunks, outcome } = await answer(
      scripted([textTurn("[^project:nebula@en]"), textTurn("He is based in Berlin.")]),
      { question: "Where is he based?" },
    );
    expect(outcome.text).toBe("He is based in Berlin.");
    const message = await browserMessage(chunks);
    expect(messageText(message)).toBe(outcome.text);
    expect(
      verifyAnswer(SESSION, outcome.messageId, outcome.text, finishMetadata(chunks).sig!),
    ).toBe(true);
  });
});

describe("the repair's parts", () => {
  it("cuts what the lookups returned as the answer's documents are cut", () => {
    const long = "x".repeat(FETCH_CLIP + 50);
    const lookups = lookupsOf([
      {
        toolResults: [
          { toolName: "get_document", input: { id: "cv@en" }, output: { text: long } },
          { toolName: "search_portfolio", input: { query: "rag" }, output: { results: [] } },
        ],
      },
    ]);
    expect(lookups[0]!.output).toHaveLength(FETCH_CLIP + 1);
    expect(lookups[0]!.output.endsWith("…")).toBe(true);
    expect(lookups[1]).toEqual({
      tool: "search_portfolio",
      input: '{"query":"rag"}',
      output: '{"results":[]}',
    });
  });

  it("joins the server's turn to the visitor's last one, after its fence", () => {
    const messages = repairMessages(
      [{ role: "user", content: wrapVisitor("Hi", "en") }],
      [{ tool: "navigate", input: "{}", output: "{}" }],
    );
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content as { type: string; text: string }[];
    expect(content[0]!.text).toBe(wrapVisitor("Hi", "en"));
    expect(content[1]!.text.endsWith(REPAIR_LINE)).toBe(true);
    // After an answer (never the case today), the turn stands alone.
    expect(repairMessages([{ role: "assistant", content: "x" }], [])).toHaveLength(2);
  });

  it("mergeInOrder settles only once every chunk is in, and keeps out what it is told to", async () => {
    const written: UIMessageChunk[] = [];
    const reads: Promise<void>[] = [];
    const writer = {
      merge(stream: ReadableStream<UIMessageChunk>) {
        reads.push(
          (async () => {
            for await (const chunk of stream) written.push(chunk);
          })(),
        );
      },
    };
    const source = simulateReadableStream<UIMessageChunk>({
      chunks: [
        { type: "text-start", id: "a" },
        { type: "text-delta", id: "a", delta: "x" },
        { type: "finish" },
      ],
      chunkDelayInMs: null,
    });
    const end = await mergeInOrder(writer, source, { keep: (c) => c.type !== "finish" });
    expect(end).toBe("done");
    expect(written.map((c) => c.type)).toEqual(["text-start", "text-delta"]);
    await Promise.all(reads);
  });
});
