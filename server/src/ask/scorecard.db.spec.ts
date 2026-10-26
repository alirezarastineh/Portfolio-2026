import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiAudit, aiGuardEvents, aiMessages, aiRateEvents, aiSettings } from "../db/schema.js";
import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { readBaseline } from "./evals/baseline.js";
import { hashWithSalt, SCORECARD_RATE, utcDay } from "./guard.js";
import { PROMPT_HASH, PROMPT_VERSION } from "./prompt.js";
import { recordedRun, resetScorecardCache, type Scorecard } from "./scorecard.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * The public scorecard (visitor plan V13): the switch and its migration, the
 * recorded run built into the API, 30 days of live checks with 20 answers
 * behind each figure, the judge's sample while it runs, aggregates only.
 */

let config: AskConfig;
const app = createApp({
  ask: {
    config: () => config,
    // The scorecard calls no model: a chain asked for fails the test.
    chain: () => {
      throw new Error("the scorecard asked for a model");
    },
    corpus: async (c) => fixtureCorpus(c),
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
let counter = 0;

/** Visitors' answers, each with whatever `row` adds; content no figure may carry. */
async function answers(
  n: number,
  row: (i: number) => Partial<typeof aiMessages.$inferInsert> = () => ({}),
): Promise<void> {
  await getDb()
    .insert(aiMessages)
    .values(
      Array.from({ length: n }, (_, i) => ({
        id: `m_card_${String(++counter).padStart(6, "0")}`,
        sessionHash: "SESSION-HASH-SENTINEL",
        locale: "en" as const,
        source: "terminal",
        route: "lite",
        questionRedacted: `QUESTION-SENTINEL ${i}`,
        answerExcerpt: "ANSWER-TEXT-SENTINEL [^profile@en].",
        totalMs: 1_000,
        tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
        finishReason: "stop",
        promptVersion: "p",
        ...row(i),
      })),
    );
}

async function publish(on = true): Promise<void> {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, publicScorecard: on })
    .onConflictDoUpdate({ target: aiSettings.id, set: { publicScorecard: on } });
  invalidateAssistantCache();
}

async function card(ip = "203.0.113.7"): Promise<{ status: number; body: Scorecard }> {
  const res = await app.request("/v1/ask/scorecard", { headers: { "x-forwarded-for": ip } });
  return { status: res.status, body: (await res.json()) as Scorecard };
}

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetScorecardCache();
  config = fixtureConfig();
});

describe("migration 0030: the scorecard's switch", () => {
  it("adds ai_settings.public_scorecard, off, so an older API's insert still works", async () => {
    await getDb().execute(sql`
      insert into ai_settings (id, enabled, daily_budget_usd, deep_enabled) values (1, true, 3, true)`);
    const { rows } = await getDb().execute<{
      published: boolean;
      type: string;
      nullable: string;
    }>(sql`
      select s.public_scorecard as published, c.data_type as type, c.is_nullable as nullable
      from ai_settings s, information_schema.columns c
      where c.table_name = 'ai_settings' and c.column_name = 'public_scorecard'`);
    expect(rows[0]).toEqual({ published: false, type: "boolean", nullable: "NO" });
  });

  it("is the admin's to switch, audited, and a save from the previous admin keeps it", async () => {
    await createAdmin();
    const admin = new TestClient(app);
    await admin.login();
    const body = {
      enabled: true,
      dailyBudgetUsd: null,
      deepEnabled: true,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
    };
    expect(
      (await admin.put("/admin/assistant/settings", { ...body, publicScorecard: true })).status,
    ).toBe(200);
    const audits = await getDb().select().from(aiAudit);
    expect(audits.map((a) => a.reason)).toContain("publicScorecard false → true");
    // The admin from before the scorecard sends no switch: it stays as stored.
    expect((await admin.put("/admin/assistant/settings", body)).status).toBe(200);
    const [row] = await getDb().select().from(aiSettings);
    expect(row!.publicScorecard).toBe(true);
  });
});

describe("GET /v1/ask/scorecard (visitor plan V13)", () => {
  it("answers 404 while unpublished, and the terminal's config says whether it is", async () => {
    const off = await card();
    expect(off).toEqual({ status: 404, body: { error: "not_published" } });
    const config = async () =>
      ((await (await app.request("/v1/ask/config")).json()) as { scorecard: boolean }).scorecard;
    expect(await config()).toBe(false);
    await publish();
    expect(await config()).toBe(true);
    expect((await card()).status).toBe(200);
  });

  it("shows the deployed prompt's recorded run and 30 days of live checks: listed fields, aggregates only", async () => {
    await answers(25, (i) => ({
      // 22 cite; 2 of them had a reference removed.
      citedIds: i < 22 ? ["profile@en"] : [],
      droppedCitations: i === 20 || i === 21 ? ["made-up@en"] : [],
      checks: {
        v: 1 as const,
        flags: i === 22 ? ["repaired"] : i === 23 ? ["ungrounded-figure"] : [],
      },
      finishReason: i === 24 ? "error:unavailable" : "stop",
      signals: i < 21 ? { v: 1 as const, shownMs: 1_000 + i * 100 } : null,
    }));
    // Outside the window, and not a visitor's: neither counts.
    await answers(1, () => ({ createdAt: new Date(Date.now() - 31 * DAY_MS) }));
    await answers(1, () => ({ source: "playground" }));
    const today = utcDay(new Date());
    await getDb()
      .insert(aiGuardEvents)
      .values([
        { day: today, kind: "invalid_input", count: 3 },
        { day: today, kind: "rate_limited", count: 2 },
        { day: today, kind: "not-a-refusal", count: 9 },
        { day: utcDay(new Date(Date.now() - 40 * DAY_MS)), kind: "busy", count: 7 },
      ]);
    await publish();

    const { status, body } = await card();
    expect(status).toBe(200);
    // Every field the scorecard carries, listed: a new one fails here until it is.
    expect(Object.keys(body).sort()).toEqual(["at", "judge", "live", "prompt", "recorded", "v"]);
    expect(Object.keys(body.live).sort()).toEqual([
      "answers",
      "citationsVerified",
      "days",
      "figuresFlagged",
      "firstWordMs",
      "minimum",
      "refusals",
      "repaired",
      "unanswered",
    ]);
    expect(body.prompt).toBe(`${PROMPT_VERSION}+${PROMPT_HASH}`);
    expect(body.live).toEqual({
      days: 30,
      minimum: 20,
      answers: 24,
      unanswered: { share: 1 / 25, n: 25 },
      citationsVerified: { share: 20 / 22, n: 22 },
      repaired: { share: 1 / 24, n: 24 },
      figuresFlagged: { share: 1 / 24, n: 24 },
      // The median of 1.0 s, 1.1 s … 3.0 s.
      firstWordMs: { median: 2_000, n: 21 },
      refusals: { invalid_input: 3, rate_limited: 2 },
    });
    // The recorded run is the one CI ties to this prompt; while a waiver stands, there is none.
    const recorded = body.recorded;
    const baseline = readBaseline();
    const deployed = `${PROMPT_VERSION}+${PROMPT_HASH}`;
    expect(recorded.measured).toBe(baseline.promptVersion === deployed);
    if (!recorded.measured) {
      expect(recorded).toEqual({ measured: false, reason: baseline.waivers[deployed] });
    } else {
      expect(Object.keys(recorded).sort()).toEqual([
        "at",
        "cases",
        "categories",
        "completed",
        "judge",
        "measured",
        "passRate",
        "passed",
      ]);
      expect(Object.keys(recorded.categories[0]!).sort()).toEqual([
        "cases",
        "completed",
        "name",
        "passed",
      ]);
      expect(recorded.passed).toBe(recorded.categories.reduce((sum, c) => sum + c.passed, 0));
    }
    // The nightly judge is off: no judge section.
    expect(body.judge).toBeNull();
    const json = JSON.stringify(body);
    expect(json).not.toMatch(
      /QUESTION-SENTINEL|ANSWER-TEXT-SENTINEL|SESSION-HASH-SENTINEL|m_card_/,
    );
  });

  it("needs 20 answers behind each figure: below that, not enough answers yet", async () => {
    await answers(19, () => ({
      citedIds: ["profile@en"],
      signals: { v: 1 as const, shownMs: 900 },
    }));
    await getDb()
      .insert(aiGuardEvents)
      .values({ day: utcDay(new Date()), kind: "busy", count: 4 });
    await publish();
    const { body } = await card();
    expect(body.live).toEqual({
      days: 30,
      minimum: 20,
      answers: 19,
      unanswered: null,
      citationsVerified: null,
      repaired: null,
      figuresFlagged: null,
      firstWordMs: null,
      refusals: null,
    });
  });

  it("shows the nightly judge's random sample while it runs: its median, with 20 judged", async () => {
    const judged = (i: number, pick: "sample" | "flagged") => ({
      judge: {
        v: 1 as const,
        model: "gemini-3.5-flash-lite",
        faithfulness: 0.5 + i * 0.025,
        helpfulness: 4,
        unsupported: [],
        at: new Date().toISOString(),
        source: "nightly" as const,
        pick,
      },
    });
    await answers(20, (i) => judged(i, "sample"));
    // A flagged pick leans toward bad answers: never in the figure.
    await answers(1, () => judged(0, "flagged"));
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, publicScorecard: true, featureSwitches: { nightlyJudge: true } });
    invalidateAssistantCache();
    const { body } = await card();
    // The 10th of 20 by nearest rank.
    expect(body.judge).toEqual({ median: 0.725, n: 20 });
  });

  it("holds its figures ten minutes", async () => {
    await answers(20);
    await publish();
    expect((await card()).body.live.answers).toBe(20);
    await answers(5);
    expect((await card()).body.live.answers).toBe(20);
    resetScorecardCache();
    expect((await card()).body.live.answers).toBe(25);
  });

  it("works with the assistant off, calling no model", async () => {
    config = fixtureConfig({ enabled: false });
    await getDb().insert(aiSettings).values({ id: 1, enabled: false, publicScorecard: true });
    invalidateAssistantCache();
    expect((await card()).status).toBe(200);
  });

  it("limits each address in a bucket of its own", async () => {
    await publish();
    const bucket = `scorecard:${hashWithSalt("ip", "203.0.113.9")}`;
    await getDb()
      .insert(aiRateEvents)
      .values(Array.from({ length: SCORECARD_RATE.perHour }, () => ({ bucket })));
    const res = await app.request("/v1/ask/scorecard", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address, and the visitors' own buckets, are untouched.
    expect((await card("203.0.113.10")).status).toBe(200);
    const visitors = await getDb()
      .select()
      .from(aiRateEvents)
      .where(sql`${aiRateEvents.bucket} like 'ip:%'`);
    expect(visitors).toEqual([]);
  });
});

describe("the recorded run", () => {
  const recorded = readBaseline();
  const version = "ask-2099-01-01.1+aaaaaaaaaaaa";

  it("is the deployed prompt's run, its counts summed from the categories", () => {
    const run = recordedRun({ ...recorded, promptVersion: version }, version);
    expect(run).toMatchObject({ measured: true, cases: recorded.cases, judge: recorded.judge });
  });

  it("says a version shipped on a waiver is not measured yet, with the waiver's reason", () => {
    expect(
      recordedRun(
        { ...recorded, waivers: { [version]: "a new prompt, measured next run" } },
        version,
      ),
    ).toEqual({ measured: false, reason: "a new prompt, measured next run" });
    expect(recordedRun(recorded, version)).toEqual({ measured: false, reason: null });
  });
});
