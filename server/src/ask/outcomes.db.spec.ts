import { beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages, contactMessages } from "../db/schema.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import { completedWeeks } from "./outcomes.js";
import { weekBounds } from "./reviews.js";
import { invalidateAssistantCache } from "./settings.js";

const app = createApp();
let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

interface OutcomesView {
  days: number;
  outcomes: Record<string, unknown>;
  browser: Record<string, unknown>;
  tours: { started: number; finished: number; finishedRate: number | null };
  primary: { metric: string; weeks: { week: string; value: number | null }[]; rotate: boolean };
  metrics: string[];
}

async function view(): Promise<OutcomesView> {
  const res = await admin.get("/admin/assistant/outcomes");
  expect(res.status).toBe(200);
  return (await res.json()) as OutcomesView;
}

/** Five visitor answers in the last complete week, one playground answer, two contact messages. */
async function seed(): Promise<string[]> {
  const weeks = completedWeeks(4);
  const start = weekBounds(weeks[3]!)!.start.getTime() + 24 * 60 * 60 * 1000;
  const at = (minutes: number) => new Date(start + minutes * 60 * 1000);
  const base = {
    locale: "en" as const,
    route: "lite",
    totalMs: 100,
    tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
    finishReason: "stop",
    promptVersion: "p",
    usd: 0.002,
    answerExcerpt: "Berlin [^profile@en].",
  };
  await getDb()
    .insert(aiMessages)
    .values([
      {
        ...base,
        id: "m_first",
        sessionHash: "s1",
        createdAt: at(0),
        questionRedacted: "Where does he live?",
      },
      // Asked again a minute later: the first answer did not land.
      {
        ...base,
        id: "m_again",
        sessionHash: "s1",
        createdAt: at(1),
        questionRedacted: "Where does he live now?",
      },
      {
        ...base,
        id: "m_flagged",
        sessionHash: "s2",
        createdAt: at(10),
        questionRedacted: "What did Atlas do?",
        checks: { v: 1 as const, flags: ["uncited"] },
      },
      {
        ...base,
        id: "m_unknown",
        sessionHash: "s3",
        createdAt: at(20),
        questionRedacted: "What is his salary?",
        answerExcerpt: "That is not in the portfolio.",
        toolCalls: ["handoff_contact"],
        handoffConfirmedAt: at(21),
      },
      {
        ...base,
        id: "m_error",
        sessionHash: "s4",
        createdAt: at(30),
        questionRedacted: "Hello?",
        answerExcerpt: "",
        finishReason: "error:unavailable",
        usd: 0,
      },
      {
        ...base,
        id: "m_playground",
        sessionHash: "s5",
        createdAt: at(40),
        questionRedacted: "x",
        source: "playground",
      },
    ]);
  await getDb().insert(aiFeedback).values({ messageId: "m_first", value: 1 });
  const message = {
    name: "Ada",
    email: "ada@example.com",
    message: "Hello there, a message.",
    ipHash: "h",
  };
  await getDb()
    .insert(contactMessages)
    .values([
      { ...message, origin: "ask" },
      { ...message, origin: "form" },
    ]);
  return weeks;
}

describe("the assistant's outcomes", () => {
  it("computes the composite, the rates and the hand-off funnel on the last 30 days", async () => {
    const weeks = await seed();
    const result = await view();
    expect(result.outcomes).toMatchObject({
      answers: 5,
      answered: 4,
      // The rephrased, the flagged and the failed answer are not helpful; an honest
      // "not in the portfolio" is.
      helpful: 2,
      funnel: { offered: 1, confirmed: 1, sent: 1 },
      rated: { up: 1, down: 0 },
      helpfulRate: 0.5,
      thumbsUpRate: 1,
      unknownRate: 0.25,
      rephraseRate: 0.25,
    });
    expect(result.outcomes["costPerAnswered"]).toBeCloseTo(0.002);
    expect(result.outcomes["costPerHelpful"]).toBeCloseTo(0.004);

    // The primary metric per weekly review: only the last one has answers.
    expect(result.primary).toEqual({
      metric: "helpfulRate",
      weeks: [
        { week: weeks[0], value: null },
        { week: weeks[1], value: null },
        { week: weeks[2], value: null },
        { week: weeks[3], value: 0.5 },
      ],
      rotate: false,
    });
    expect(result.metrics).toEqual(["helpfulRate", "thumbsUpRate", "unknownRate", "rephraseRate"]);
  });

  it("reads what the browsers saw and why the thumbs-downs, from the rows (visitor plan V2)", async () => {
    await seed();
    const db = getDb();
    await db
      .update(aiMessages)
      .set({
        signals: { v: 1, shownMs: 600, doneMs: 1_500, followups: 1 },
        ttftMs: 400,
        toolCalls: ["suggest_followups"],
      })
      .where(eq(aiMessages.id, "m_first"));
    await db
      .update(aiMessages)
      .set({
        signals: { v: 1, shownMs: 1_200, doneMs: 3_000, stopped: true },
        ttftMs: 800,
        toolCalls: ["suggest_followups"],
        citedIds: ["profile@en"],
      })
      .where(eq(aiMessages.id, "m_flagged"));
    await db.insert(aiFeedback).values({ messageId: "m_flagged", value: -1, reason: "wrong" });

    expect((await view()).browser).toEqual({
      reported: 2,
      shownP50Ms: 600,
      shownP95Ms: 1_200,
      serverP50Ms: 400,
      serverP95Ms: 800,
      stopRate: 0.5,
      copyRate: 0,
      followupRate: 0.5,
      citationRate: 0,
      retried: 0,
      downReasons: { wrong: 1, unanswered: 0, length: 0, none: 0 },
    });
  });

  it("counts the guided tours and the share finished, and never as answers (visitor plan V16)", async () => {
    await seed();
    const before = (await view()).outcomes;
    const tour = {
      locale: "en" as const,
      route: "tour",
      sessionHash: "s9",
      totalMs: 100,
      tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "p",
      usd: 0.001,
      questionRedacted: "data platforms",
      answerExcerpt: "Three stops.",
    };
    await getDb()
      .insert(aiMessages)
      .values([
        { ...tour, id: "m_tour_done", signals: { v: 1, tourSteps: 3, tourDone: true } },
        { ...tour, id: "m_tour_left", signals: { v: 1, tourSteps: 1 } },
        { ...tour, id: "m_tour_none" },
      ]);
    const result = await view();
    expect(result.tours).toEqual({ started: 3, finished: 1, finishedRate: 1 / 3 });
    expect(result.outcomes).toEqual(before);
  });

  it("never counts a matched brief as an answer (visitor plan V19)", async () => {
    await seed();
    const before = (await view()).outcomes;
    await getDb()
      .insert(aiMessages)
      .values({
        id: "m_match_one",
        locale: "en",
        route: "match",
        sessionHash: "s10",
        totalMs: 100,
        tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
        finishReason: "stop",
        promptVersion: "p",
        usd: 0.004,
        questionRedacted: "Senior AI engineer: RAG in production.",
        answerExcerpt: "Published evidence for 1 of 1 requirement.",
        handoffConfirmedAt: new Date(),
      });
    expect((await view()).outcomes).toEqual(before);
  });

  it("switches the primary metric, and refuses one it does not know", async () => {
    await seed();
    expect(
      (await admin.put("/admin/assistant/primary-metric", { metric: "unknownRate" })).status,
    ).toBe(200);
    const result = await view();
    expect(result.primary.metric).toBe("unknownRate");
    expect(result.primary.weeks.at(-1)).toMatchObject({ value: 0.25 });
    expect((await admin.put("/admin/assistant/primary-metric", { metric: "revenue" })).status).toBe(
      400,
    );
  });

  it("is admin-only", async () => {
    const anonymous = new TestClient(app);
    expect((await anonymous.get("/admin/assistant/outcomes")).status).toBe(401);
  });
});
