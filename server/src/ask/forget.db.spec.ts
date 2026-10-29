import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  aiCorpusSnapshots,
  aiEvalCases,
  aiFeedback,
  aiInsightSnapshots,
  aiMessages,
  aiRateEvents,
  aiReviews,
  aiUsage,
  contactMessages,
} from "../db/schema.js";
import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { drain, mockEntry, scripted, textTurn } from "../test/ask-models.js";
import { resetDb } from "../test/helpers.js";
import { streamAnswer } from "./agent.js";
import type { AskConfig } from "./config.js";
import { resetRecordedSnapshots } from "./corpus/snapshots.js";
import { resetForgotten } from "./forget.js";
import { FORGET_RATE, hashWithSalt } from "./guard.js";
import { flushGuardEvents, pendingGuardEvents } from "./guard-events.js";
import { wrapVisitor } from "./prompt.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * `POST /v1/ask/forget` (visitor plan V14): a visitor deletes what the log
 * keeps of their tab's conversation. That session's visitor answers only, with
 * their feedback, signals and reviews; the insights' quotes of its questions in
 * the same transaction; the contact message and the frozen case kept, their
 * links set null.
 */

let config: AskConfig;
const app = createApp({
  ask: {
    config: () => config,
    chain: () => [],
    corpus: async (c) => fixtureCorpus(c),
  },
});

const MINE = "forget-session-mine-0001";
const THEIRS = "forget-session-theirs-01";
const mine = hashWithSalt("session", MINE);

function row(id: string, sessionHash: string, question: string, extra: object = {}) {
  return {
    id,
    sessionHash,
    locale: "en" as const,
    route: "lite",
    questionRedacted: question,
    answerExcerpt: "He lives in Berlin [^profile@en].",
    totalMs: 900,
    tokens: { input: 10, cached: 0, output: 5, thoughts: 0 },
    finishReason: "stop",
    promptVersion: "p",
    ...extra,
  };
}

function forget(sessionId: string, ip = "198.51.100.40") {
  return app.request("/v1/ask/forget", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ sessionId }),
  });
}

const forgottenCount = () =>
  pendingGuardEvents()
    .filter((e) => e.kind === "forgotten")
    .reduce((sum, e) => sum + e.count, 0);

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetRecordedSnapshots();
  resetForgotten();
  // Counts from earlier tests are not this one's.
  await flushGuardEvents(async () => undefined);
  config = fixtureConfig();
});

describe("POST /v1/ask/forget (visitor plan V14)", () => {
  it("deletes that session's answers with their feedback, signals and reviews, and only those", async () => {
    await getDb()
      .insert(aiMessages)
      .values([
        row("m_forget_mine_01", mine, "Where does he live?", {
          signals: { v: 1 as const, shownMs: 800 },
        }),
        row("m_forget_mine_02", mine, "What is Atlas?"),
        row("m_forget_mine_03", mine, "Is he available?"),
        row("m_forget_theirs1", hashWithSalt("session", THEIRS), "What is Atlas?"),
        // The same hash in the playground is not a visitor's answer: never the visitor's to delete.
        row("m_forget_play_01", mine, "Draft question", { source: "playground" }),
      ]);
    await getDb()
      .insert(aiFeedback)
      .values([
        { messageId: "m_forget_mine_01", value: -1, reason: "wrong" },
        { messageId: "m_forget_theirs1", value: 1 },
      ]);
    await getDb()
      .insert(aiReviews)
      .values({
        messageId: "m_forget_mine_02",
        labels: { correct: true, grounded: true, helpful: true, tone: true, language: true },
      });

    const res = await forget(MINE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 3 });

    const left = await getDb().select({ id: aiMessages.id }).from(aiMessages);
    expect(left.map((r) => r.id).sort()).toEqual(["m_forget_play_01", "m_forget_theirs1"]);
    expect((await getDb().select().from(aiFeedback)).map((f) => f.messageId)).toEqual([
      "m_forget_theirs1",
    ]);
    expect(await getDb().select().from(aiReviews)).toEqual([]);
    // Counted as an aggregate, never whose.
    expect(forgottenCount()).toBe(1);
  });

  it("keeps the contact message the visitor sent, with its copy, and a frozen case, their links set null", async () => {
    await getDb()
      .insert(aiMessages)
      .values(row("m_forget_mine_01", mine, "I want to hire him for a contract"));
    await getDb()
      .insert(aiCorpusSnapshots)
      .values({ key: "en:1#forget", documents: [], projects: [], posts: [], coreTokens: 1 });
    const [frozen] = await getDb()
      .insert(aiEvalCases)
      .values({
        question: "Is he open to contract work?",
        locale: "en",
        snapshotKey: "en:1#forget",
        fromMessageId: "m_forget_mine_01",
      })
      .returning({ id: aiEvalCases.id });
    const transcript = {
      v: 1 as const,
      turns: [
        { question: "I want to hire him", answer: "Glad to help.", cited: [], at: "2026-10-22" },
      ],
    };
    await getDb().insert(contactMessages).values({
      name: "Ada",
      email: "ada@example.com",
      message: "About a contract.",
      ipHash: "ip",
      origin: "ask",
      askMessageId: "m_forget_mine_01",
      askTranscript: transcript,
    });

    expect(await (await forget(MINE)).json()).toEqual({ ok: true, deleted: 1 });
    const [contact] = await getDb().select().from(contactMessages);
    expect(contact).toMatchObject({ askMessageId: null, askTranscript: transcript });
    const [kept] = await getDb().select().from(aiEvalCases).where(eq(aiEvalCases.id, frozen!.id));
    expect(kept).toMatchObject({ question: "Is he open to contract work?", fromMessageId: null });
  });

  it("removes the insights runs' quotes of its briefs' items too (visitor plan V20)", async () => {
    await getDb()
      .insert(aiMessages)
      .values(
        row("m_forget_match01", mine, "Embedded engineer: C firmware.", {
          route: "match",
          trace: {
            v: 1,
            steps: [],
            match: {
              kind: "role",
              items: [
                {
                  text: "Embedded C firmware",
                  priority: "must",
                  status: "not-published",
                  hits: [],
                },
              ],
              repaired: { plan: false, rows: false },
            },
          },
        }),
      );
    const topics = [
      {
        title: "Firmware",
        summary: "Embedded work",
        questions: 2,
        examples: ["embedded  c FIRMWARE", "Kubernetes on bare metal"],
        unanswered: true,
      },
    ];
    await getDb().insert(aiInsightSnapshots).values({ trigger: "admin", analysed: 2, topics });

    await forget(MINE);
    const [snapshot] = await getDb().select().from(aiInsightSnapshots);
    expect(snapshot!.topics).toEqual([{ ...topics[0], examples: ["Kubernetes on bare metal"] }]);
  });

  it("removes the insights runs' quotes of its questions, in case and spacing as quoted, and no other", async () => {
    await getDb()
      .insert(aiMessages)
      .values([
        row("m_forget_mine_01", mine, "Where does he live?"),
        row("m_forget_theirs1", hashWithSalt("session", THEIRS), "What is Atlas?"),
      ]);
    const topics = [
      {
        title: "Location",
        summary: "Where he is based",
        questions: 4,
        examples: ["  where does HE   live? ", "What is Atlas?", "Does he relocate?"],
        unanswered: false,
      },
      { title: "Projects", summary: "His work", questions: 2, examples: [], unanswered: false },
    ];
    await getDb().insert(aiInsightSnapshots).values({ trigger: "admin", analysed: 6, topics });

    await forget(MINE);
    const [snapshot] = await getDb().select().from(aiInsightSnapshots);
    expect(snapshot!.topics).toEqual([
      { ...topics[0], examples: ["What is Atlas?", "Does he relocate?"] },
      topics[1],
    ]);
  });

  it("takes the tab's sessions before its resets too, never another tab's", async () => {
    const before = "forget-session-before-01";
    await getDb()
      .insert(aiMessages)
      .values([
        row("m_forget_mine_01", mine, "What is Atlas?"),
        row("m_forget_before1", hashWithSalt("session", before), "Where does he live?"),
        row("m_forget_theirs1", hashWithSalt("session", THEIRS), "Is he available?"),
      ]);
    const res = await app.request("/v1/ask/forget", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.43" },
      body: JSON.stringify({ sessionId: MINE, earlier: [before, MINE] }),
    });
    expect(await res.json()).toEqual({ ok: true, deleted: 2 });
    const left = await getDb().select({ id: aiMessages.id }).from(aiMessages);
    expect(left.map((r) => r.id)).toEqual(["m_forget_theirs1"]);
    // At most ten earlier sessions: a body with more is not the terminal's.
    const many = Array.from(
      { length: 11 },
      (_, i) => `forget-session-many-${String(i).padStart(4, "0")}`,
    );
    const refused = await app.request("/v1/ask/forget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: MINE, earlier: many }),
    });
    expect(refused.status).toBe(400);
  });

  it("answers 0 for a session the log does not know, and counts nothing", async () => {
    await getDb()
      .insert(aiMessages)
      .values(row("m_forget_theirs1", "other", "What is Atlas?"));
    expect(await (await forget("never-seen-session-0001")).json()).toEqual({
      ok: true,
      deleted: 0,
    });
    expect(await getDb().select().from(aiMessages)).toHaveLength(1);
    expect(forgottenCount()).toBe(0);
  });

  it("refuses what no terminal sends, and limits each address", async () => {
    const bad = (body: unknown) =>
      app.request("/v1/ask/forget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await bad({})).status).toBe(400);
    expect((await bad({ sessionId: "short" })).status).toBe(400);

    const bucket = `forget:${hashWithSalt("ip", "198.51.100.41")}`;
    await getDb()
      .insert(aiRateEvents)
      .values(Array.from({ length: FORGET_RATE.perHour }, () => ({ bucket })));
    const limited = await forget(MINE, "198.51.100.41");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await forget(MINE, "198.51.100.42")).status).toBe(200);
  });

  it("keeps an answer still being written for a forgotten session out of the log; its spend still counts", async () => {
    await forget(MINE);
    const model = scripted([textTurn("He lives in Berlin [^profile@en].")]);
    const answer = streamAnswer({
      messages: [{ role: "user", content: wrapVisitor("Where does he live?", "en") }],
      question: "Where does he live?",
      locale: "en",
      language: "en",
      sessionId: MINE,
      sessionHash: mine,
      source: "terminal",
      route: { route: "lite", reason: "default" },
      corpus: fixtureCorpus(config),
      config,
      chain: [mockEntry("gemini-3.5-flash-lite", model.model)],
      abortSignal: new AbortController().signal,
    });
    await drain(answer.stream);
    const outcome = await answer.done;
    expect(outcome.text).toContain("Berlin");
    expect(
      await getDb().select().from(aiMessages).where(eq(aiMessages.id, outcome.messageId)),
    ).toEqual([]);
    expect(await getDb().select().from(aiUsage)).toHaveLength(1);
  });
});
