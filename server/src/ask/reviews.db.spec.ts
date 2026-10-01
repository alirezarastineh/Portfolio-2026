import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages, aiReviews } from "../db/schema.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import { isoWeek } from "./reviews.js";

const app = createApp();
let admin: TestClient;

interface Entry {
  message: { id: string; question: string; feedback: number | null };
  reasons: string[];
  sampled: boolean;
  review: {
    labels: Record<string, boolean | null>;
    note: string | null;
    reviewedAt: string;
  } | null;
}
interface Queue {
  week: string;
  previous: string;
  next: string | null;
  queue: Entry[];
  stats: {
    answers: number;
    queued: number;
    reviewed: number;
    labels: Record<string, { good: number; bad: number }>;
  };
}

const LABELS = { correct: true, grounded: false, helpful: true, tone: null, language: true };

function answer(id: string, createdAt: Date, extra: Partial<typeof aiMessages.$inferInsert> = {}) {
  return {
    id,
    createdAt,
    sessionHash: "s",
    locale: "en" as const,
    route: "lite",
    questionRedacted: `question ${id}`,
    answerExcerpt: "Python and Angular.",
    totalMs: 100,
    tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
    finishReason: "stop",
    promptVersion: "p",
    ...extra,
  };
}

async function queueOf(week?: string): Promise<Queue> {
  const res = await admin.get(`/admin/assistant/reviews${week ? `?week=${week}` : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Queue;
}

/** Thirty answers in 2026-W39, three of them flagged, and three that must not count. */
async function seedWeek(): Promise<void> {
  const at = (minutes: number) => new Date(Date.UTC(2026, 8, 23, 10, minutes));
  await getDb()
    .insert(aiMessages)
    .values([
      ...Array.from({ length: 30 }, (_, i) =>
        answer(`m_${String(i).padStart(2, "0")}`, at(i), {
          ...(i === 1 ? { checks: { v: 1 as const, flags: ["uncited"] } } : {}),
          ...(i === 3 ? { answerExcerpt: "That is not in the portfolio." } : {}),
        }),
      ),
      answer("p_playground", at(40), { source: "playground" }),
      answer("w_previous", new Date(Date.UTC(2026, 8, 20, 23, 59))),
      answer("w_next", new Date(Date.UTC(2026, 8, 28, 0, 0))),
    ]);
  await getDb().insert(aiFeedback).values({ messageId: "m_02", value: -1 });
}

beforeEach(async () => {
  await resetDb();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

describe("the review queue API", () => {
  it("is admin-only", async () => {
    const anonymous = new TestClient(app);
    expect((await anonymous.get("/admin/assistant/reviews")).status).toBe(401);
    expect((await anonymous.put("/admin/assistant/reviews/m_00", {})).status).toBe(401);
  });

  it("gives the same queue for the same week: flagged answers first, then the sample", async () => {
    await seedWeek();
    const first = await queueOf("2026-W39");
    expect(await queueOf("2026-W39")).toEqual(first);

    expect(first).toMatchObject({ week: "2026-W39", previous: "2026-W38", next: "2026-W40" });
    expect(first.stats).toMatchObject({ answers: 30, reviewed: 0 });
    const flagged = first.queue.slice(0, 3);
    expect(Object.fromEntries(flagged.map((e) => [e.message.id, e.reasons]))).toEqual({
      m_01: ["check:uncited"],
      m_02: ["thumbs down"],
      m_03: ["didn't know"],
    });
    expect(first.queue.slice(3).every((e) => e.reasons.length === 0 && e.sampled)).toBe(true);
    expect(first.queue.filter((e) => e.sampled)).toHaveLength(10);
    expect(first.stats.queued).toBe(first.queue.length);
    // An answer as Conversations shows it, the thumbs-down included.
    expect(flagged.find((e) => e.message.id === "m_02")!.message).toMatchObject({
      question: "question m_02",
      feedback: -1,
    });
  });

  it("keeps a review, updates it in place and counts only the sample in the label shares", async () => {
    await seedWeek();
    const before = await queueOf("2026-W39");
    const sampled = before.queue.find((e) => e.sampled && !e.reasons.length)!;
    const flaggedOnly = before.queue.find((e) => e.reasons.length && !e.sampled);
    expect(flaggedOnly).toBeDefined();

    const path = `/admin/assistant/reviews/${sampled.message.id}`;
    const saved = await admin.put(path, { labels: { ...LABELS, correct: false }, note: null });
    expect(saved.status).toBe(200);
    const again = await admin.put(path, { labels: LABELS, note: "  thin on sources " });
    expect(await again.json()).toEqual({ ok: true, reviewedAt: expect.any(String) });
    await admin.put(`/admin/assistant/reviews/${flaggedOnly!.message.id}`, {
      labels: { ...LABELS, correct: false },
      note: null,
    });

    const rows = await getDb().select().from(aiReviews);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.messageId === sampled.message.id)).toMatchObject({
      labels: LABELS,
      note: "thin on sources",
    });

    const after = await queueOf("2026-W39");
    expect(after.queue.map((e) => e.message.id)).toEqual(before.queue.map((e) => e.message.id));
    expect(after.queue.find((e) => e.message.id === sampled.message.id)!.review).toMatchObject({
      labels: LABELS,
      note: "thin on sources",
    });
    expect(after.stats.reviewed).toBe(2);
    // The flagged-only answer's "not correct" stays out of the estimate.
    expect(after.stats.labels).toEqual({
      correct: { good: 1, bad: 0 },
      grounded: { good: 0, bad: 1 },
      helpful: { good: 1, bad: 0 },
      tone: { good: 0, bad: 0 },
      language: { good: 1, bad: 0 },
    });

    // A review goes with its answer.
    await getDb().delete(aiMessages).where(eq(aiMessages.id, sampled.message.id));
    expect(await getDb().select().from(aiReviews)).toHaveLength(1);
  });

  it("starts at the current week, which has no next one yet", async () => {
    await getDb().insert(aiMessages).values(answer("m_now", new Date()));
    const current = await queueOf();
    expect(current.week).toBe(isoWeek(new Date()));
    expect(current.next).toBeNull();
    expect(current.queue.map((e) => e.message.id)).toEqual(["m_now"]);
  });

  it("refuses a week that does not exist, an answer it does not know and a partial review", async () => {
    await seedWeek();
    expect((await admin.get("/admin/assistant/reviews?week=2026-39")).status).toBe(400);
    expect((await admin.get("/admin/assistant/reviews?week=2025-W53")).status).toBe(400);
    const review = { labels: LABELS, note: null };
    expect((await admin.put("/admin/assistant/reviews/m_missing", review)).status).toBe(404);
    // Playground answers are the admin's own; they are not reviewed.
    expect((await admin.put("/admin/assistant/reviews/p_playground", review)).status).toBe(404);
    const partial = { labels: { correct: true }, note: null };
    expect((await admin.put("/admin/assistant/reviews/m_00", partial)).status).toBe(400);
    expect(await getDb().select().from(aiReviews)).toHaveLength(0);
  });
});
