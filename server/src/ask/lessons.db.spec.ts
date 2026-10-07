import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb, getPool } from "../db/client.js";
import {
  aiAudit,
  aiInsightSnapshots,
  aiJournal,
  aiLessons,
  aiMessages,
  aiSettings,
  aiUsageFeatures,
} from "../db/schema.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { generating, mockEntry, type ScriptedModel } from "../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { pruneInsightSnapshots } from "./insights.js";
import type { JournalDiagnosis } from "./journal.js";
import { runLearningCheck } from "./learning-monitor.js";
import { resetBreakers } from "./models/circuit.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * Plan phase 25: the adaptive trigger and automatic insights, the insights
 * kept as snapshots, and lessons: corroborated, applied, measured before and
 * since, retired when they fail.
 */

let config: AskConfig;
let insight: ScriptedModel;

const TOPICS = {
  topics: [
    {
      title: "Kafka and streaming",
      summary: "Visitors ask which projects use Kafka.",
      questions: 6,
      examples: ["Which projects use Kafka?"],
      unanswered: true,
    },
  ],
};

const app = createApp({
  ask: {
    config: () => config,
    chain: (_config, role) =>
      role === "insight" ? [mockEntry("gemini-3.5-flash-lite", insight.model)] : [],
    corpus: async (c) => fixtureCorpus(c),
    evalPacing: null,
  },
});

let admin: TestClient;
let seq = 0;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig();
  insight = generating([JSON.stringify(TOPICS)]);
  seq = 0;
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const KAFKA = "Which projects use Kafka?";

/** Visitor answers, each this many minutes ago: "it isn't there" when failed. */
async function seed(answers: { minutesAgo: number; failed?: boolean; question?: string }[]) {
  await getDb()
    .insert(aiMessages)
    .values(
      answers.map((a) => {
        seq++;
        return {
          id: `m_lesson${String(seq).padStart(5, "0")}`,
          // One session each: no answer reads as rephrased.
          sessionHash: `session-${seq}`,
          locale: "en" as const,
          route: "lite",
          questionRedacted: a.question ?? KAFKA,
          answerExcerpt: a.failed
            ? "That is not in the portfolio."
            : "Atlas uses pgvector [^project:atlas@en].",
          totalMs: 900,
          tokens: { input: 100, cached: 0, output: 20, thoughts: 0 },
          finishReason: "stop",
          promptVersion: "ask-test",
          checks: { v: 1 as const, flags: [] },
          createdAt: sql`now() - make_interval(mins => ${a.minutesAgo})`,
        };
      }),
    );
}

/** 60 answers: the 30 before with 4 failed, the last 30 with 9 (the newest first). */
async function spike(): Promise<void> {
  await seed([
    ...Array.from({ length: 30 }, (_, i) => ({ minutesAgo: 1 + i, failed: i < 9 })),
    ...Array.from({ length: 30 }, (_, i) => ({ minutesAgo: 31 + i, failed: i < 4 })),
  ]);
}

async function switchOn(feature: string): Promise<void> {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, featureSwitches: { [feature]: true } })
    .onConflictDoUpdate({ target: aiSettings.id, set: { featureSwitches: { [feature]: true } } });
  invalidateAssistantCache();
}

async function journalEntries(statuses: string[]): Promise<string[]> {
  const rows = await getDb()
    .insert(aiJournal)
    .values(
      statuses.map((status) => ({
        messageIds: [],
        category: "unknown",
        diagnosis: {} as JournalDiagnosis,
        status: status as never,
      })),
    )
    .returning({ id: aiJournal.id });
  return rows.map((r) => r.id);
}

const STATEMENT =
  "When visitors ask about streaming and the portfolio does not say, answer it once in the FAQ.";

describe("the tables (migration 0021)", () => {
  it("keeps insights runs and lessons, with their checks", async () => {
    const columns = async (table: string) =>
      (
        await getDb().execute<{ column_name: string }>(
          sql`select column_name from information_schema.columns where table_name = ${table} order by column_name`,
        )
      ).rows.map((r) => r.column_name);
    expect(await columns("ai_insight_snapshots")).toEqual([
      "analysed",
      "created_at",
      "id",
      "newest_at",
      "newest_message_id",
      "reason",
      "seen_at",
      "topics",
      "trigger",
      "usd",
    ]);
    expect(await columns("ai_lessons")).toEqual([
      "applied_as",
      "applied_at",
      "applied_ref",
      "created_at",
      "decided_at",
      "decided_by",
      "effectiveness",
      "id",
      "journal_ids",
      "reopened_at",
      "retired_reason",
      "scope",
      "source",
      "statement",
      "status",
      "topic",
      "updated_at",
    ]);
    const bad = getDb()
      .insert(aiLessons)
      .values({ statement: "x", source: "journal", status: "maybe" as never });
    await expect(bad).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("the adaptive trigger", () => {
  it("runs insights once when failures rise, and the notice shows until seen (the done-when)", async () => {
    await spike();
    await switchOn("autoInsights");

    const first = await runLearningCheck(config);
    expect(first?.trigger).toMatchObject({
      fire: true,
      ran: true,
      recent: { answers: 30, failed: 9 },
      previous: { answers: 30, failed: 4 },
    });
    const snapshots = await getDb().select().from(aiInsightSnapshots);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ trigger: "auto", analysed: 60, seenAt: null });
    expect(snapshots[0]!.reason).toMatch(/^failures rose: the last 30: 9 failed/);
    const spent = await getDb().select().from(aiUsageFeatures);
    expect(new Set(spent.map((r) => r.feature))).toEqual(new Set(["autoInsights"]));

    // Once: nothing new since, so the next night holds.
    const second = await runLearningCheck(config);
    expect(second?.trigger).toMatchObject({ fire: false, ran: false });
    expect(second?.trigger.reason).toBe("0 new answers since the last insights; 10 needed");
    expect(await getDb().select().from(aiInsightSnapshots)).toHaveLength(1);
    expect(insight.calls).toHaveLength(1);

    const health = (await (await admin.get("/admin/assistant/health")).json()) as {
      learning: { notice: { id: string; unanswered: number } | null };
    };
    expect(health.learning.notice).toMatchObject({ id: snapshots[0]!.id, unanswered: 1 });
    const seen = await admin.post(`/admin/assistant/insights/${snapshots[0]!.id}/seen`, {});
    expect(seen.status).toBe(200);
    const after = (await (await admin.get("/admin/assistant/health")).json()) as {
      learning: { notice: unknown };
    };
    expect(after.learning.notice).toBeNull();

    const checks = await getDb().select().from(aiAudit).where(eq(aiAudit.action, "learning.check"));
    expect(checks.map((c) => c.decision)).toEqual(["allowed", "allowed"]);
  });

  it("spends nothing while automatic insights are off, and says it would have run", async () => {
    await spike();
    const check = await runLearningCheck(config);
    expect(check?.trigger).toMatchObject({ fire: true, ran: false, skipped: "feature_off" });
    expect(await getDb().select().from(aiInsightSnapshots)).toHaveLength(0);
    expect(await getDb().select().from(aiUsageFeatures)).toHaveLength(0);
    expect(insight.calls).toHaveLength(0);
    const [row] = await getDb().select().from(aiAudit).where(eq(aiAudit.action, "learning.check"));
    expect(row).toMatchObject({ decision: "denied" });
    expect(row!.reason).toMatch(/insights did not run: automatic insights are switched off/);
    // The Insights tab shows it.
    const view = (await (await admin.get("/admin/assistant/insights")).json()) as {
      snapshot: unknown;
      trigger: { decision: string; reason: string };
    };
    expect(view.snapshot).toBeNull();
    expect(view.trigger).toMatchObject({ decision: "denied" });
  });

  it("holds while failures are flat", async () => {
    await seed(Array.from({ length: 60 }, (_, i) => ({ minutesAgo: 1 + i, failed: i % 10 === 0 })));
    await switchOn("autoInsights");
    const check = await runLearningCheck(config);
    expect(check?.trigger.fire).toBe(false);
    expect(check?.trigger.reason).toMatch(/^failures did not rise/);
    expect(insight.calls).toHaveLength(0);
  });
});

describe("insights, kept", () => {
  it("serves the previous admin as before, from the latest run, and shows it without spending", async () => {
    await seed([{ minutesAgo: 1, failed: true }]);
    const first = await admin.post("/admin/assistant/insights");
    const ran = (await first.json()) as { snapshot: { id: string; trigger: string } };
    expect(ran).toMatchObject({
      analysed: 1,
      topics: [{ title: "Kafka and streaming" }],
      // The run its topics come from: what a lesson made from one names.
      snapshot: { id: expect.any(String), trigger: "admin" },
    });
    const cached = await admin.post("/admin/assistant/insights");
    expect(await cached.json()).toMatchObject({
      cached: true,
      analysed: 1,
      snapshot: { id: ran.snapshot.id },
    });
    expect(insight.calls).toHaveLength(1);
    const refreshed = await admin.post("/admin/assistant/insights?refresh=1");
    expect(refreshed.status).toBe(200);
    expect(insight.calls).toHaveLength(2);

    const view = (await (await admin.get("/admin/assistant/insights")).json()) as {
      snapshot: { trigger: string; seenAt: string | null; topics: unknown[] };
    };
    expect(view.snapshot).toMatchObject({ trigger: "admin" });
    expect(view.snapshot.seenAt).not.toBeNull();
    expect(insight.calls).toHaveLength(2);
    const spent = await getDb().select().from(aiUsageFeatures);
    expect(new Set(spent.map((r) => r.feature))).toEqual(new Set(["insights"]));
  });

  it("goes 59 days after it ran, so no question it quotes outlives the answers' 90 days", async () => {
    const at = (days: number) => sql`now() - make_interval(days => ${days})`;
    await getDb()
      .insert(aiInsightSnapshots)
      .values([
        { trigger: "admin", analysed: 1, topics: [], createdAt: at(60) },
        { trigger: "auto", analysed: 1, topics: [], createdAt: at(58) },
        { trigger: "admin", analysed: 1, topics: [] },
      ]);
    await pruneInsightSnapshots();
    expect(await getDb().select().from(aiInsightSnapshots)).toHaveLength(2);
  });

  it("clears the notice of every run before the one seen, and the admin's own run clears them too", async () => {
    const hoursAgo = (hours: number) => sql`now() - make_interval(hours => ${hours})`;
    const runs = await getDb()
      .insert(aiInsightSnapshots)
      .values([
        { trigger: "auto", analysed: 9, topics: [], reason: "older", createdAt: hoursAgo(48) },
        { trigger: "auto", analysed: 9, topics: [], reason: "newer", createdAt: hoursAgo(24) },
      ])
      .returning({ id: aiInsightSnapshots.id });
    const notice = async () =>
      (
        (await (await admin.get("/admin/assistant/health")).json()) as {
          learning: { notice: { id: string } | null };
        }
      ).learning.notice;
    expect(await notice()).toMatchObject({ id: runs[1]!.id });
    expect((await admin.post(`/admin/assistant/insights/${runs[1]!.id}/seen`, {})).status).toBe(
      200,
    );
    // The older one does not come back.
    expect(await notice()).toBeNull();
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await admin.post(`/admin/assistant/insights/${missing}/seen`, {})).status).toBe(404);

    // A new automatic run, then the admin runs insights: nothing is left to notice.
    await getDb()
      .insert(aiInsightSnapshots)
      .values({
        trigger: "auto",
        analysed: 9,
        topics: [],
        reason: "latest",
        createdAt: hoursAgo(12),
      });
    expect(await notice()).not.toBeNull();
    await seed([{ minutesAgo: 1, failed: true }]);
    expect((await admin.post("/admin/assistant/insights?refresh=1")).status).toBe(200);
    expect(await notice()).toBeNull();
  });
});

describe("lessons", () => {
  async function lesson(journalIds: string[]): Promise<{ id: string; status: string }> {
    const res = await admin.post("/admin/assistant/lessons", {
      source: "journal",
      statement: STATEMENT,
      scope: ["Kafka", "streaming"],
      journalIds,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { lesson: { id: string; status: string } }).lesson;
  }

  async function applied(id: string, daysAgo: number): Promise<void> {
    const res = await admin.patch(`/admin/assistant/lessons/${id}`, {
      apply: { as: "faq", ref: "faq:kafka" },
    });
    expect(res.status).toBe(200);
    await getDb()
      .update(aiLessons)
      .set({ appliedAt: sql`now() - make_interval(days => ${daysAgo})` })
      .where(eq(aiLessons.id, id));
  }

  interface LessonView {
    id: string;
    status: string;
    scope: string[];
    appliedAs: string | null;
    retiredReason: string | null;
    decidedBy: string | null;
    topic: Record<string, unknown> | null;
    effect: {
      before: Record<string, number>;
      after: Record<string, number>;
      applications: number;
      value: number | null;
    } | null;
  }

  const listed = async () =>
    (await (await admin.get("/admin/assistant/lessons")).json()) as {
      lessons: LessonView[];
      counts: Record<string, number>;
    };

  it("tracks a fixed topic's answers before and since the fix (the done-when)", async () => {
    const { id, status } = await lesson(await journalEntries(["accepted", "fixed", "accepted"]));
    expect(status).toBe("proposed");
    await applied(id, 1);
    const day = 24 * 60;
    await seed([
      // Before: the topic asked three times, never answered.
      { minutesAgo: 3 * day, failed: true },
      { minutesAgo: 4 * day, failed: true },
      { minutesAgo: 5 * day, failed: true },
      // Since: five times, four answered.
      ...[60, 120, 180, 240].map((minutesAgo) => ({ minutesAgo })),
      { minutesAgo: 300, failed: true },
      // Another topic, either side: not counted.
      { minutesAgo: 30, failed: true, question: "Where does he live?" },
      { minutesAgo: 2 * day, failed: true, question: "Where does he live?" },
    ]);

    const { lessons, counts } = await listed();
    expect(counts).toEqual({ proposed: 0, active: 1, retired: 0 });
    expect(lessons[0]).toMatchObject({
      id,
      status: "active",
      appliedAs: "faq",
      scope: ["kafka", "streaming"],
      effect: {
        before: { answers: 3, unknown: 3, down: 0, failed: 3 },
        after: { answers: 5, unknown: 1, down: 0, failed: 1 },
        applications: 5,
        value: 0.8,
      },
    });

    // The nightly check stores it and keeps a lesson that works.
    const check = await runLearningCheck(config);
    expect(check?.lessons).toEqual({ measured: 1, retired: [] });
    const [row] = await getDb().select().from(aiLessons).where(eq(aiLessons.id, id));
    expect(row).toMatchObject({ status: "active", effectiveness: { applications: 5, value: 0.8 } });
  });

  it("retires a lesson that fails after five applications, and the admin can reopen it", async () => {
    const { id } = await lesson(await journalEntries(["accepted", "accepted", "accepted"]));
    await applied(id, 1);
    await seed([
      ...[60, 120].map((minutesAgo) => ({ minutesAgo })),
      ...[180, 240, 300].map((minutesAgo) => ({ minutesAgo, failed: true })),
    ]);

    const check = await runLearningCheck(config);
    expect(check?.lessons).toEqual({ measured: 1, retired: [id] });
    const retired = (await listed()).lessons[0]!;
    expect(retired).toMatchObject({
      status: "retired",
      decidedBy: "system",
      retiredReason: "effectiveness 0.40 after 5 applications (floor 0.5)",
    });
    const [audited] = await getDb()
      .select()
      .from(aiAudit)
      .where(eq(aiAudit.action, "lesson.retire"));
    expect(audited).toMatchObject({ actor: "system", target: id });

    // Retired: no decision but reopening; reopened, it is applied again.
    const apply = await admin.patch(`/admin/assistant/lessons/${id}`, {
      apply: { as: "faq", ref: "faq:kafka-2" },
    });
    expect(apply.status).toBe(409);
    const reopened = await admin.patch(`/admin/assistant/lessons/${id}`, { reopen: true });
    expect(((await reopened.json()) as { lesson: LessonView }).lesson).toMatchObject({
      status: "active",
      retiredReason: null,
      decidedBy: null,
    });
    expect((await admin.patch(`/admin/assistant/lessons/${id}`, { reopen: true })).status).toBe(
      409,
    );

    // Reopened, it is measured again from now: the answers that retired it do not, the next night.
    const next = await runLearningCheck(config);
    expect(next?.lessons).toEqual({ measured: 1, retired: [] });
    expect((await listed()).lessons[0]).toMatchObject({
      status: "active",
      effect: { applications: 0, value: null },
    });
  });

  it("takes the admin's own retirement, reopening and edits, and refuses vague words", async () => {
    const { id } = await lesson(await journalEntries(["accepted", "fixed", "accepted"]));
    const patch = (target: string, body: Record<string, unknown>) =>
      admin.patch(`/admin/assistant/lessons/${target}`, body);
    const refused = async (body: Record<string, unknown>, error: string, status = 400) => {
      const res = await patch(id, body);
      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    };
    await refused({ statement: "Be careful." }, "vague_statement");
    await refused({ scope: ["ab", "!!"] }, "empty_scope");
    expect((await patch("00000000-0000-4000-8000-000000000000", { retire: true })).status).toBe(
      404,
    );

    const retired = await patch(id, { retire: true });
    expect(((await retired.json()) as { lesson: LessonView }).lesson).toMatchObject({
      status: "retired",
      decidedBy: "admin",
      retiredReason: "retired by the admin",
    });
    await refused({ retire: true }, "bad_transition", 409);
    // Never applied: reopened, it is proposed again.
    const reopened = await patch(id, { reopen: true });
    expect(((await reopened.json()) as { lesson: LessonView }).lesson).toMatchObject({
      status: "proposed",
      decidedBy: null,
      retiredReason: null,
    });
    const edited = await patch(id, {
      statement: `${STATEMENT} Say where.`,
      scope: ["Kafka", "events"],
    });
    expect(((await edited.json()) as { lesson: LessonView }).lesson).toMatchObject({
      status: "proposed",
      scope: ["kafka", "events"],
    });
  });

  /** Until another session waits on a lock: the request has reached the row the test holds. */
  const waitingOnLock = () =>
    eventually(async () => {
      const { rows } = await getDb().execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks where not granted`,
      );
      return rows[0]!.n > 0 ? true : undefined;
    });

  it("decides on the lesson as it stands once the nightly check lets go of it", async () => {
    const { id } = await lesson(await journalEntries(["accepted", "fixed", "accepted"]));
    await applied(id, 1);
    // The nightly check holds the row, and retires the lesson; the admin applies it meanwhile.
    const check = await getPool().connect();
    try {
      await check.query("BEGIN");
      await check.query("SELECT id FROM ai_lessons WHERE id = $1 FOR UPDATE", [id]);
      const apply = admin.patch(`/admin/assistant/lessons/${id}`, {
        apply: { as: "faq", ref: "faq:kafka-2" },
      });
      await waitingOnLock();
      await check.query(
        "UPDATE ai_lessons SET status = 'retired', retired_reason = 'below the floor', decided_by = 'system', decided_at = now() WHERE id = $1",
        [id],
      );
      await check.query("COMMIT");
      // The apply reads the retirement: refused, never written over it.
      expect((await apply).status).toBe(409);
    } finally {
      check.release();
    }
    const [row] = await getDb().select().from(aiLessons).where(eq(aiLessons.id, id));
    expect(row).toMatchObject({ status: "retired", decidedBy: "system" });
  });

  it("measures a lesson as it stands once the admin's edit lets go of it", async () => {
    const { id } = await lesson(await journalEntries(["accepted", "fixed", "accepted"]));
    await applied(id, 1);
    // Five answers since the fix, three of them failing: enough to retire it…
    await seed([
      ...[60, 120].map((minutesAgo) => ({ minutesAgo })),
      ...[180, 240, 300].map((minutesAgo) => ({ minutesAgo, failed: true })),
    ]);
    const edit = await getPool().connect();
    try {
      await edit.query("BEGIN");
      await edit.query("SELECT id FROM ai_lessons WHERE id = $1 FOR UPDATE", [id]);
      const check = runLearningCheck(config);
      await waitingOnLock();
      // …but the admin applies it again while the check waits: measured from now.
      await edit.query(
        "UPDATE ai_lessons SET applied_at = now(), applied_ref = 'faq:kafka-2' WHERE id = $1",
        [id],
      );
      await edit.query("COMMIT");
      expect((await check)?.lessons).toEqual({ measured: 1, retired: [] });
    } finally {
      edit.release();
    }
    const [row] = await getDb().select().from(aiLessons).where(eq(aiLessons.id, id));
    expect(row).toMatchObject({ status: "active", effectiveness: { applications: 0 } });
  });

  it("checks on one process at a time", async () => {
    const other = await getPool().connect();
    try {
      await other.query("SELECT pg_advisory_lock($1)", [8_741_221]);
      expect(await runLearningCheck(config)).toBeNull();
    } finally {
      await other.query("SELECT pg_advisory_unlock($1)", [8_741_221]);
      other.release();
    }
    expect(await runLearningCheck(config)).not.toBeNull();
  });

  it("keeps only corroborated lessons, in the admin's words", async () => {
    const two = await journalEntries(["accepted", "fixed"]);
    const post = (body: Record<string, unknown>) => admin.post("/admin/assistant/lessons", body);
    const refused = async (body: Record<string, unknown>, error: string) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    };
    const journal = { source: "journal", statement: STATEMENT, scope: ["kafka"] };

    await refused({ ...journal, journalIds: two }, "not_corroborated");
    const proposed = await journalEntries(["proposed"]);
    await refused({ ...journal, journalIds: [...two, ...proposed] }, "not_corroborated");
    // Every entry decided: three decided and an undecided one are refused, the reason given.
    const decided = await journalEntries(["accepted", "accepted", "fixed"]);
    const mixed = await post({ ...journal, journalIds: [...decided, ...proposed] });
    expect(await mixed.json()).toEqual({
      error: "not_corroborated",
      detail: { reason: "every journal entry of a lesson must be accepted or fixed; 1 is not" },
    });
    const many = Array.from(
      { length: 21 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await refused({ ...journal, journalIds: many }, "invalid_input");
    await refused(
      { ...journal, journalIds: [...two, "00000000-0000-4000-8000-000000000000"] },
      "unknown_entry",
    );
    const three = await journalEntries(["accepted", "accepted", "fixed"]);
    await refused({ ...journal, journalIds: three, statement: "Be careful." }, "vague_statement");
    await refused({ ...journal, journalIds: three, scope: ["ab", "!!"] }, "empty_scope");

    // From insights: an unanswered topic of five questions or more.
    const [snapshot] = await getDb()
      .insert(aiInsightSnapshots)
      .values({
        trigger: "admin",
        analysed: 9,
        topics: [
          { title: "Kafka", summary: "s", questions: 6, examples: ["Kafka?"], unanswered: true },
          { title: "Visa", summary: "s", questions: 4, examples: ["Visa?"], unanswered: true },
          { title: "Atlas", summary: "s", questions: 9, examples: ["Atlas?"], unanswered: false },
        ],
      })
      .returning({ id: aiInsightSnapshots.id });
    const fromTopic = { source: "insight", statement: STATEMENT, scope: ["kafka"] };
    await refused({ ...fromTopic, snapshotId: snapshot!.id, topic: 1 }, "not_corroborated");
    await refused({ ...fromTopic, snapshotId: snapshot!.id, topic: 2 }, "not_corroborated");
    await refused({ ...fromTopic, snapshotId: snapshot!.id, topic: 7 }, "unknown_topic");
    const made = await post({ ...fromTopic, snapshotId: snapshot!.id, topic: 0 });
    expect(made.status).toBe(201);
    const { lesson: kept } = (await made.json()) as { lesson: LessonView };
    // The topic's name and counts, never its example questions.
    expect(kept.topic).toEqual({
      snapshotId: snapshot!.id,
      title: "Kafka",
      questions: 6,
      unanswered: true,
    });

    expect(
      (await admin.patch(`/admin/assistant/lessons/${kept.id}`, { retire: true, reopen: true }))
        .status,
    ).toBe(400);
    expect((await admin.delete(`/admin/assistant/lessons/${kept.id}`)).status).toBe(200);
    expect((await admin.delete(`/admin/assistant/lessons/${kept.id}`)).status).toBe(404);
  });

  it("is the admin's alone", async () => {
    const stranger = new TestClient(app, "198.51.100.7");
    expect((await stranger.get("/admin/assistant/lessons")).status).toBe(401);
    expect((await stranger.get("/admin/assistant/insights")).status).toBe(401);
  });
});
