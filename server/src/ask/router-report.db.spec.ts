import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages } from "../db/schema.js";
import { fixtureConfig } from "../test/ask-fixtures.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AnswerTrace } from "./trace.js";

/**
 * Plan phase 20: the router's report through the admin route, read from the
 * log as it is written: the route column, the trace's routing and
 * escalation, the feedback join.
 */

const app = createApp({ ask: { config: () => fixtureConfig() } });
let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const trace = (extra: Partial<AnswerTrace>): AnswerTrace => ({ v: 1, steps: [], ...extra });

async function seed(): Promise<void> {
  const base = {
    locale: "en" as const,
    totalMs: 900,
    finishReason: "stop",
    promptVersion: "p",
    sessionHash: "s",
    source: "terminal",
    usd: 0.001,
    tokens: { input: 1_000, cached: 0, output: 50, thoughts: 0 },
  };
  const day = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await getDb()
    .insert(aiMessages)
    .values([
      {
        ...base,
        id: "m_lookup0001",
        route: "lite",
        ttftMs: 500,
        questionRedacted: "Where is he based?",
        trace: trace({ routing: { reason: "default+lookup", lookup: true } }),
        createdAt: day(1),
      },
      {
        ...base,
        id: "m_lite00001",
        route: "lite",
        ttftMs: 1_500,
        questionRedacted: "Which of his projects scaled the furthest?",
        trace: trace({ routing: { reason: "default" } }),
        createdAt: day(1),
      },
      {
        ...base,
        id: "m_moved0001",
        route: "lite→deep",
        ttftMs: 2_500,
        questionRedacted: "Tell me about his projects",
        trace: trace({
          routing: { reason: "default" },
          escalation: { step: 2, reason: "projects-fetched" },
        }),
        createdAt: day(2),
      },
      {
        ...base,
        id: "m_careful01",
        route: "lite",
        ttftMs: 1_200,
        questionRedacted: "What salary does he expect?",
        trace: trace({
          routing: { reason: "default+sensitive:compensation", sensitive: "compensation" },
        }),
        createdAt: day(3),
      },
      // An answer from before phase 20: no routing in its trace, a plain lite answer.
      {
        ...base,
        id: "m_before001",
        route: "lite",
        ttftMs: 1_800,
        questionRedacted: "Hi",
        createdAt: day(4),
      },
      // Outside a week, and not a visitor's.
      {
        ...base,
        id: "m_old000001",
        route: "lite",
        ttftMs: 1_000,
        questionRedacted: "Old",
        createdAt: day(20),
      },
      {
        ...base,
        id: "m_eval00001",
        source: "eval",
        route: "deep",
        ttftMs: 3_000,
        questionRedacted: "Eval",
        createdAt: day(1),
      },
    ]);
  await getDb().insert(aiFeedback).values({ messageId: "m_lite00001", value: -1 });
}

describe("GET /admin/assistant/router", () => {
  it("reports a week of visitor answers by tier, with the false-simple candidates", async () => {
    await seed();
    const res = await admin.get("/admin/assistant/router");
    expect(res.status).toBe(200);
    const report = (await res.json()) as Record<string, unknown> & {
      tiers: { tier: string; answers: number; p50TtftMs: number | null }[];
    };
    expect(report).toMatchObject({
      days: 7,
      answers: 5,
      sensitive: { answers: 1, byTopic: { compensation: 1 } },
      escalation: { answers: 1, byReason: { "projects-fetched": 1 } },
      falseSimple: {
        kept: 4,
        candidates: 1,
        byReason: { flagged: 0, "thumbs-down": 1, rephrased: 0 },
        listed: [
          {
            id: "m_lite00001",
            question: "Which of his projects scaled the furthest?",
            tier: "lite",
            reasons: ["thumbs-down"],
          },
        ],
      },
    });
    const tiers = Object.fromEntries(report.tiers.map((t) => [t.tier, t]));
    expect(tiers["lookup"]).toMatchObject({ answers: 1, p50TtftMs: 500 });
    expect(tiers["lite"]).toMatchObject({ answers: 3 });
    expect(tiers["escalated"]).toMatchObject({ answers: 1, p50TtftMs: 2_500 });
    expect(tiers["deep"]).toMatchObject({ answers: 0 });

    const month = (await (await admin.get("/admin/assistant/router?days=30")).json()) as {
      answers: number;
    };
    expect(month.answers).toBe(6);
    expect((await admin.get("/admin/assistant/router?days=0")).status).toBe(400);
  });

  it("is the admin's alone", async () => {
    expect((await app.request("/admin/assistant/router")).status).toBe(401);
  });
});
