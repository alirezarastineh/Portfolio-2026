import { readUIMessageStream, type UIMessageChunk } from "ai";
import { beforeEach, describe, expect, it } from "vitest";

import { fixtureConfig, fixtureCorpus, twoProjectCorpus } from "../test/ask-fixtures.js";
import {
  apiError,
  drain,
  failing,
  finish,
  mockEntry,
  scripted,
  textAndToolTurn,
  textTurn,
  toolTurn,
} from "../test/ask-models.js";
import { streamAnswer, type AnswerMetadata, type AnswerRequest } from "./agent.js";
import { resetBreakers } from "./models/circuit.js";
import type { ModelEntry } from "./models/registry.js";
import { pageDocument } from "./page.js";
import { PROMPT_CANARY, wrapVisitor } from "./prompt.js";
import { answerReceipt, RECEIPT_FIELDS } from "./receipt.js";
import type { RouteDecision } from "./router.js";

/**
 * The answer's receipt (visitor plan V12): counts and codes only, its fields
 * listed, as the finish's metadata carries them; the transient failover
 * status; and the guard's tally in the trace.
 */

const LITE: RouteDecision = { route: "lite", reason: "default" };
const QUESTION = "What did he build with Atlas?";

function run(chain: ModelEntry[], extra: Partial<AnswerRequest> = {}) {
  const config = fixtureConfig();
  return streamAnswer({
    messages: [{ role: "user", content: wrapVisitor(QUESTION, "en") }],
    question: QUESTION,
    locale: "en",
    language: "en",
    sessionId: "receipt-session-0000001",
    sessionHash: "receipt",
    source: "eval",
    route: LITE,
    corpus: fixtureCorpus(config),
    config,
    chain,
    abortSignal: new AbortController().signal,
    persist: false,
    ...extra,
  });
}

async function finished(answer: ReturnType<typeof streamAnswer>) {
  const chunks = await drain(answer.stream);
  const meta = chunks.find((c) => c.type === "finish")?.messageMetadata as AnswerMetadata;
  return { chunks, meta, outcome: await answer.done };
}

beforeEach(() => resetBreakers());

describe("the receipt", () => {
  it("lists every field it may carry: one not listed never joins it", () => {
    const all = answerReceipt(
      {
        routing: { reason: "default+sensitive:contract", sensitive: "contract" },
        escalation: { step: 2, reason: "projects-fetched" },
        page: { id: "project:atlas@en", promoted: true },
        focus: { kind: "section", verified: true },
        level: "plain",
        repair: { reason: "no-words", by: "model" },
        match: {
          kind: "role",
          items: [
            { text: "Python", priority: "must", status: "evidence", hits: ["skills@en"] },
            { text: "Rust", priority: "nice", status: "not-published", hits: [], downgraded: true },
            { text: "Go", priority: "nice", status: null, hits: [] },
          ],
          repaired: { plan: false, rows: true },
        },
      },
      { toolNames: ["search_portfolio"], cited: 1, dropped: [] },
    );
    expect(Object.keys(all).sort()).toEqual([...RECEIPT_FIELDS].sort());
    expect(all).toEqual({
      lookups: 1,
      sources: 1,
      removed: 0,
      escalation: "projects-fetched",
      careful: "contract",
      page: "project:atlas@en",
      focus: { kind: "section", verified: true },
      level: "plain",
      repair: { reason: "no-words", by: "model" },
      // A match's rows (visitor plan V19): those it showed, and those the critic took back.
      match: { kind: "role", rows: 2, downgraded: 1 },
    });
    // A match's own searches count as lookups.
    expect(answerReceipt({}, { toolNames: [], cited: 0, dropped: [], searches: 3 }).lookups).toBe(
      3,
    );
    // Nothing more than the counts for an ordinary answer: no reason string, no step.
    expect(
      answerReceipt(
        { routing: { reason: "default+lookup", lookup: true } },
        {
          toolNames: [],
          cited: 0,
          dropped: [],
        },
      ),
    ).toEqual({ lookups: 0, sources: 0, removed: 0 });
  });

  it("counts the lookups, the sources and each invented reference once, through the real agent", async () => {
    const model = scripted([
      toolTurn("search_portfolio", { query: "atlas" }, "s1"),
      toolTurn("get_document", { id: "project:atlas@en" }, "g1"),
      textAndToolTurn(
        "Atlas [^project:atlas@en] [^project:nebula@en] and [^project:nebula@en] [^made-up@en].",
        "suggest_followups",
        { items: ["Which stack?"] },
      ),
    ]);
    const { meta } = await finished(run([mockEntry("gemini-3.5-flash-lite", model.model)]));
    expect(meta.receipt).toEqual({ lookups: 2, sources: 1, removed: 2 });
  });

  it("names the careful topic, the page, what was pointed at and the level, as codes", async () => {
    const config = fixtureConfig();
    const corpus = twoProjectCorpus(config);
    const model = scripted([textTurn("Borealis is a pipeline [^project:borealis@en].")]);
    const { meta } = await finished(
      run([mockEntry("gemini-3.5-flash-lite", model.model)], {
        corpus,
        route: { route: "lite", reason: "default+sensitive:contract", sensitive: "contract" },
        page: pageDocument(corpus, "/en/work/borealis", "en"),
        focus: { block: null, fenced: null, trace: { kind: "code", verified: false } },
        level: "expert",
      }),
    );
    expect(meta.receipt).toEqual({
      lookups: 0,
      sources: 1,
      removed: 0,
      careful: "contract",
      page: "project:borealis@en",
      focus: { kind: "code", verified: false },
      level: "expert",
    });
    // Codes only: neither the question nor a title rides along.
    expect(JSON.stringify(meta.receipt)).not.toMatch(/Borealis is|What did he/);
  });

  it("names an escalation and a repair by their codes", async () => {
    const lite = scripted([
      toolTurn("get_document", { id: "project:atlas@en" }, "c1"),
      toolTurn("get_document", { id: "project:borealis@en" }, "c2"),
    ]);
    const deep = scripted([textTurn("Both [^project:atlas@en][^project:borealis@en].")]);
    const moved = await finished(
      run([mockEntry("gemini-3.5-flash-lite", lite.model)], {
        corpus: twoProjectCorpus(fixtureConfig()),
        escalation: () => [mockEntry("gemini-3.7-flash", deep.model)],
      }),
    );
    expect(moved.meta.receipt).toMatchObject({
      lookups: 2,
      sources: 2,
      escalation: "projects-fetched",
    });

    const empty = scripted([
      [{ type: "stream-start", warnings: [] }, finish("stop")],
      textTurn("He built Atlas [^project:atlas@en]."),
    ]);
    const repaired = await finished(run([mockEntry("gemini-3.5-flash-lite", empty.model)]));
    expect(repaired.meta.receipt).toMatchObject({ repair: { reason: "no-words", by: "model" } });
  });
});

describe("the failover status", () => {
  it("tells the browser before the first words, as a transient part the message never keeps", async () => {
    const backup = scripted([textTurn("From the backup.")]);
    const { chunks, outcome } = await finished(
      run([
        mockEntry("gemini-3.5-flash-lite", failing(apiError(503)).model),
        mockEntry("gemini-3.1-flash-lite", backup.model),
      ]),
    );
    const status = chunks.findIndex((c) => c.type === "data-status");
    expect(chunks[status]).toEqual({
      type: "data-status",
      data: { code: "failover", position: 2, of: 2 },
      transient: true,
    });
    expect(status).toBeLessThan(chunks.findIndex((c) => c.type === "text-delta"));
    expect(chunks.filter((c) => c.type === "data-status")).toHaveLength(1);

    // The message the browser builds holds the words, not the status.
    let message: { parts: { type: string }[] } | undefined;
    for await (const m of readUIMessageStream({
      stream: new ReadableStream<UIMessageChunk>({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk);
          c.close();
        },
      }),
    })) {
      message = m;
    }
    expect(message?.parts.map((p) => p.type)).not.toContain("data-status");
    expect(outcome.text).toBe("From the backup.");
  });

  it("stays silent when the first model answers", async () => {
    const model = scripted([textTurn("Right away.")]);
    const { chunks } = await finished(run([mockEntry("gemini-3.5-flash-lite", model.model)]));
    expect(chunks.some((c) => c.type === "data-status")).toBe(false);
  });
});

describe("the guard's tally", () => {
  it("keeps what the output guard removed in the trace, by kind and count, never the text", async () => {
    const model = scripted([textTurn(`The marker is ${PROMPT_CANARY}, again ${PROMPT_CANARY}.`)]);
    const { outcome } = await finished(run([mockEntry("gemini-3.5-flash-lite", model.model)]));
    expect(outcome.steps?.guard).toEqual({ canary: 2 });
    expect(outcome.checks.flags).toContain("leak");
    expect(JSON.stringify(outcome.steps)).not.toContain(PROMPT_CANARY);
  });
});
