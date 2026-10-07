import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { asc, eq, sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  aiAudit,
  aiCorpusSnapshots,
  aiFeedback,
  aiMessages,
  aiRunItems,
  aiRuns,
  aiSettings,
  aiUsageFeatures,
} from "../db/schema.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { mockEntry, scripted, textTurn, usage } from "../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { resetRecordedSnapshots } from "./corpus/snapshots.js";
import { utcDay } from "./guard.js";
import { costUsd } from "./models/prices.js";
import type { ChainRole, ModelEntry } from "./models/registry.js";
import { previousDay, startNightly } from "./nightly-judge.js";
import { dearestItemUsd } from "./runs/store.js";
import { resetBreakers } from "./models/circuit.js";
import { isoWeek } from "./reviews.js";
import { invalidateAssistantCache } from "./settings.js";

/**
 * Plan phase 26: the nightly sampled judge. A night picks the previous UTC
 * day's sample and its flagged answers, judges each against its snapshot's
 * documents, spends as `nightlyJudge`, and stays under that cap.
 */

let config: AskConfig;
/** The judge must be a model that answers visitors to read their answers. */
let judgeId = "gemini-3.5-flash-lite";
const judgePrompts: string[] = [];

const judge = new MockLanguageModelV4({
  modelId: "judge",
  doGenerate: async (options) => {
    const prompt = JSON.stringify(options.prompt);
    judgePrompts.push(prompt);
    // An answer that invents a figure is judged unfaithful.
    const unfaithful = prompt.includes("99%");
    const verdict = unfaithful
      ? { faithfulness: 0.4, helpfulness: 2, unsupported: ["99%"] }
      : { faithfulness: 1, helpfulness: 5, unsupported: [] };
    return {
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage(50, 10),
      warnings: [],
    };
  },
});
const lite = scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);

const app = createApp({
  ask: {
    config: () => config,
    chain: (_config, role: ChainRole): ModelEntry[] =>
      role === "judge"
        ? [mockEntry(judgeId, judge)]
        : [mockEntry("gemini-3.5-flash-lite", lite.model)],
    corpus: async (c) => fixtureCorpus(c),
    evalPacing: null,
  },
});

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  resetRecordedSnapshots();
  config = fixtureConfig({ firstChunkTimeoutMs: 20_000, requestTimeoutMs: 30_000 });
  judgeId = "gemini-3.5-flash-lite";
  judgePrompts.length = 0;
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const NOW = new Date();
const yesterday = previousDay(NOW);
/** One verdict's cost: the mock judge's tokens at the visitor model's price. */
const VERDICT_USD = costUsd(
  "gemini-3.5-flash-lite",
  { input: 50, cached: 0, output: 10, thoughts: 0 },
  NOW,
);

let seq = 0;
/** Visitor answers given `minutes` after the start of `day` (yesterday by default). */
async function seed(
  answers: {
    minutes?: number;
    day?: Date;
    flags?: string[];
    answer?: string;
    corpusKey?: string | null;
    finishReason?: string;
  }[],
): Promise<string[]> {
  const ids = answers.map(() => `m_nightly${String(++seq).padStart(5, "0")}`);
  await getDb()
    .insert(aiMessages)
    .values(
      answers.map((a, i) => ({
        id: ids[i]!,
        createdAt: new Date((a.day ?? yesterday.start).getTime() + (a.minutes ?? i) * 60_000),
        sessionHash: `s${i}`,
        locale: "en" as const,
        route: "lite",
        questionRedacted: "Which project cut support escalations?",
        answerExcerpt: a.answer ?? "Atlas cut escalations by 38% [^project:atlas@en].",
        citedIds: ["project:atlas@en"],
        model: "gemini-3.5-flash-lite",
        totalMs: 900,
        tokens: { input: 100, cached: 0, output: 20, thoughts: 0 },
        finishReason: a.finishReason ?? "stop",
        promptVersion: "ask-test",
        corpusKey: a.corpusKey ?? null,
        checks: { v: 1 as const, flags: (a.flags ?? []) as never },
      })),
    );
  return ids;
}

async function nightlyOn(cap: number | null = null): Promise<void> {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, featureSwitches: { nightlyJudge: true }, featureCaps: { nightlyJudge: cap } })
    .onConflictDoUpdate({
      target: aiSettings.id,
      set: { featureSwitches: { nightlyJudge: true }, featureCaps: { nightlyJudge: cap } },
    });
  invalidateAssistantCache();
}

interface RunView {
  run: { id: string; status: string; error: string | null; params: { picks: unknown[] } };
  items: { key: string; status: string; usd: number }[];
}
const read = async (id: string) =>
  (await (await admin.get(`/admin/assistant/runs/${id}`)).json()) as RunView;
const until = (id: string, test: (view: RunView) => boolean) =>
  eventually(async () => {
    const view = await read(id);
    return test(view) ? view : undefined;
  });

const verdicts = async () =>
  new Map(
    (await getDb().select({ id: aiMessages.id, judge: aiMessages.judge }).from(aiMessages)).map(
      (r) => [r.id, r.judge],
    ),
  );

const nightlyAudit = () =>
  getDb()
    .select()
    .from(aiAudit)
    .where(eq(aiAudit.action, "judge.nightly"))
    .orderBy(asc(aiAudit.id));

describe("a night's run", () => {
  it("judges the day's sample and its flagged answers, under its cap, the verdicts on those rows only (the done-when)", async () => {
    // Twenty answers yesterday, two of them flagged; one the day before, one today.
    const day = await seed(
      Array.from({ length: 20 }, (_, i) => ({ flags: i === 4 || i === 9 ? ["uncited"] : [] })),
    );
    const [before] = await seed([{ day: new Date(yesterday.start.getTime() - 86_400_000) }]);
    const [today] = await seed([{ day: yesterday.end }]);
    await getDb().insert(aiFeedback).values({ messageId: day[12]!, value: -1 });
    await nightlyOn();

    const started = await startNightly(config, NOW);
    expect(started).toMatchObject({ run: expect.any(String) });
    const id = (started as { run: string }).run;
    const done = await until(id, (v) => v.run.status === "done");

    // 5 % of 20, at least 3: a sample of 3, then the flagged ones it did not draw.
    const picks = done.run.params.picks as { id: string; pick: string }[];
    const sampled = picks.filter((p) => p.pick === "sample").map((p) => p.id);
    expect(sampled).toHaveLength(3);
    const flagged = [day[4]!, day[9]!, day[12]!];
    expect(picks.filter((p) => p.pick === "flagged").map((p) => p.id)).toEqual(
      flagged.filter((f) => !sampled.includes(f)),
    );
    const all = await verdicts();
    for (const pick of picks) {
      expect(all.get(pick.id)).toMatchObject({
        v: 1,
        model: "gemini-3.5-flash-lite",
        faithfulness: 1,
        source: "nightly",
        pick: pick.pick,
      });
    }
    const picked = new Set(picks.map((p) => p.id));
    for (const id of [...day, before!, today!].filter((m) => !picked.has(m))) {
      expect(all.get(id)).toBeNull();
    }

    // Spent as the nightly judge's, one verdict a pick (its cap: the next test).
    const spent = await getDb().select().from(aiUsageFeatures);
    expect(new Set(spent.map((r) => r.feature))).toEqual(new Set(["nightlyJudge"]));
    const usd = spent.reduce((sum, r) => sum + r.usd, 0);
    expect(usd).toBeCloseTo(picks.length * VERDICT_USD, 12);
    // The run keeps the scores, never the judge's quotes (runs are not pruned; answers are).
    const items = await getDb().select().from(aiRunItems).where(eq(aiRunItems.runId, id));
    for (const item of items) {
      expect(item.result).toMatchObject({ faithfulness: 1, source: "nightly", unsupported: 0 });
    }

    const [allowed] = await nightlyAudit();
    expect(allowed).toMatchObject({ actor: "system", target: id, decision: "allowed" });
    expect(allowed!.reason).toBe(
      `${picks.length} answers of ${yesterday.day} to judge: 3 sampled, ${picks.length - 3} flagged`,
    );
  });

  it("stops before an answer that would take it past its cap, and a resume does not cross it", async () => {
    await seed(Array.from({ length: 5 }, () => ({ flags: ["uncited"] })));
    // Room for two verdicts and a half.
    await nightlyOn(VERDICT_USD * 2.5);
    const started = (await startNightly(config, NOW)) as { run: string };
    const stopped = await until(started.run, (v) => v.run.status === "failed");
    expect(stopped.run.error).toMatch(/its own daily cap/);
    expect(stopped.items.map((i) => i.status)).toEqual([
      "done",
      "done",
      "pending",
      "pending",
      "pending",
    ]);
    const spend = async () =>
      (await getDb().select().from(aiUsageFeatures)).reduce((sum, r) => sum + r.usd, 0);
    expect(await spend()).toBeCloseTo(2 * VERDICT_USD, 12);
    expect(await spend()).toBeLessThan(VERDICT_USD * 2.5);

    // Resumed the same day, the run projects the next answer from those it judged: still under.
    expect((await admin.post(`/admin/assistant/runs/${started.run}/resume`, {})).status).toBe(202);
    const again = await until(started.run, (v) => v.run.status === "failed");
    expect(again.items.filter((i) => i.status === "done")).toHaveLength(2);
    expect(await spend()).toBeLessThan(VERDICT_USD * 2.5);
    expect(judgePrompts).toHaveLength(2);

    // With the cap raised, the night resumes and judges only what was left.
    await nightlyOn(VERDICT_USD * 10);
    expect((await admin.post(`/admin/assistant/runs/${started.run}/resume`, {})).status).toBe(202);
    const done = await until(started.run, (v) => v.run.status === "done");
    expect(done.items.map((i) => i.status)).toEqual(["done", "done", "done", "done", "done"]);
    expect(judgePrompts).toHaveLength(5);
  });

  it("projects from the last seven nights only, never from a calibration run", async () => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    const run = async (nightly: boolean, at: Date, usd: number) => {
      const [row] = await getDb()
        .insert(aiRuns)
        .values({
          kind: "judge",
          status: "done",
          params: nightly ? { nightly: true, day: "2026-10-01", picks: [] } : { judge: "x" },
          createdAt: at,
        })
        .returning({ id: aiRuns.id, kind: aiRuns.kind, params: aiRuns.params });
      await getDb()
        .insert(aiRunItems)
        .values({ runId: row!.id, key: "m_lookback01", position: 0, status: "done", usd });
      return row!;
    };
    // The eighth night back cost ten verdicts, a calibration run twenty: neither counts.
    await run(true, minutesAgo(80), 10 * VERDICT_USD);
    for (let i = 7; i >= 1; i--) await run(true, minutesAgo(i * 10), VERDICT_USD);
    const calibration = await run(false, minutesAgo(5), 20 * VERDICT_USD);
    const [tonight] = await getDb()
      .insert(aiRuns)
      .values({
        kind: "judge",
        status: "running",
        params: { nightly: true, day: "2026-10-06", picks: [] },
      })
      .returning({ id: aiRuns.id, kind: aiRuns.kind, params: aiRuns.params });
    expect(await dearestItemUsd(tonight!)).toBeCloseTo(VERDICT_USD, 15);
    // A calibration run looks at calibration runs only.
    expect(await dearestItemUsd({ ...calibration, id: tonight!.id })).toBeCloseTo(
      20 * VERDICT_USD,
      15,
    );
  });

  it("projects a new night's first answer from the last nights' dearest", async () => {
    await seed([{}, {}]);
    // A night before, whose dearest verdict cost one VERDICT_USD…
    const [before] = await getDb()
      .insert(aiRuns)
      .values({
        kind: "judge",
        status: "done",
        params: { nightly: true, day: "2026-10-01", picks: [] },
      })
      .returning({ id: aiRuns.id });
    await getDb().insert(aiRunItems).values({
      runId: before!.id,
      key: "m_before0001",
      position: 0,
      status: "done",
      usd: VERDICT_USD,
    });
    // …and today already within half a verdict of the cap (a resumed night, say).
    const cap = VERDICT_USD * 3;
    await getDb()
      .insert(aiUsageFeatures)
      .values({
        day: utcDay(new Date()),
        feature: "nightlyJudge",
        model: "gemini-3.5-flash-lite",
        usd: cap - VERDICT_USD / 2,
      });
    await nightlyOn(cap);
    const started = (await startNightly(config, NOW)) as { run: string };
    const stopped = await until(started.run, (v) => v.run.status === "failed");
    // The first answer would cross the cap: not started, nothing spent.
    expect(stopped.run.error).toMatch(/its own daily cap/);
    expect(judgePrompts).toHaveLength(0);
  });

  it("judges an answer against the documents it read, as its snapshot holds them", async () => {
    const corpus = fixtureCorpus(config);
    const documents = corpus.documents.map((d) =>
      d.id === "project:atlas@en"
        ? { ...d, text: "Atlas, as the answer read it: SNAPSHOT-ONLY." }
        : d,
    );
    await getDb().insert(aiCorpusSnapshots).values({
      key: "snap#night",
      documents,
      projects: corpus.projects,
      posts: corpus.posts,
      coreTokens: 1,
    });
    const [kept, gone] = await seed([{ corpusKey: "snap#night" }, { corpusKey: "snap#pruned" }]);
    await nightlyOn();
    const started = (await startNightly(config, NOW)) as { run: string };
    await until(started.run, (v) => v.run.status === "done");

    expect(judgePrompts).toHaveLength(2);
    const order = (await read(started.run)).items.map((i) => i.key);
    const promptFor = (id: string) => judgePrompts[order.indexOf(id)]!;
    expect(promptFor(kept!)).toContain("SNAPSHOT-ONLY");
    // No snapshot kept: today's corpus.
    expect(promptFor(gone!)).not.toContain("SNAPSHOT-ONLY");
    expect(promptFor(gone!)).toContain("[project:atlas@en]");
  });

  it("puts an answer judged unfaithful in the week's review queue", async () => {
    const [bad] = await seed([{ answer: "Atlas cut escalations by 99% [^project:atlas@en]." }]);
    await nightlyOn();
    const started = (await startNightly(config, NOW)) as { run: string };
    await until(started.run, (v) => v.run.status === "done");
    expect((await verdicts()).get(bad!)).toMatchObject({ faithfulness: 0.4, pick: "sample" });

    const week = (await (
      await admin.get(`/admin/assistant/reviews?week=${isoWeek(yesterday.start)}`)
    ).json()) as {
      queue: { message: { id: string }; reasons: string[] }[];
    };
    expect(week.queue.find((e) => e.message.id === bad)?.reasons).toEqual(["judge:unfaithful"]);
  });

  it("shows on the Overview: faithfulness per model and route, the sample apart, and the last night", async () => {
    // Four flagged answers, each inventing a figure: a sample of three, then the flagged one left.
    await seed(
      Array.from({ length: 4 }, () => ({
        answer: "Atlas cut escalations by 99% [^project:atlas@en].",
        flags: ["uncited"],
      })),
    );
    await nightlyOn();
    const started = (await startNightly(config, NOW)) as { run: string };
    await until(started.run, (v) => v.run.status === "done");

    const res = await admin.get("/admin/assistant/faithfulness?days=30");
    expect(res.status).toBe(200);
    const unfaithful = (judged: number) => ({
      judged,
      faithfulness: expect.closeTo(0.4, 10),
      helpfulness: 2,
      below: judged,
    });
    expect(await res.json()).toMatchObject({
      days: 30,
      judge: "gemini-3.5-flash-lite",
      judges: [{ model: "gemini-3.5-flash-lite", judged: 4 }],
      byModel: [{ key: "gemini-3.5-flash-lite", sampled: unfaithful(3), all: unfaithful(4) }],
      byRoute: [{ key: "lite", sampled: unfaithful(3), all: unfaithful(4) }],
      nightly: {
        id: started.run,
        day: yesterday.day,
        status: "done",
        judged: 4,
        total: 4,
        error: null,
      },
    });
    expect((await admin.get("/admin/assistant/faithfulness?days=0")).status).toBe(400);
    const stranger = new TestClient(app, "198.51.100.8");
    expect((await stranger.get("/admin/assistant/faithfulness")).status).toBe(401);
  });
});

describe("judge runs from before the nightly judge", () => {
  it("lose their quotes to the one-off scrub in DEPLOYMENT.md, keeping the scores, and twice is once", async () => {
    const [old] = await getDb()
      .insert(aiRuns)
      .values({ kind: "judge", status: "done", params: { judge: "gemini-3.5-flash-lite" } })
      .returning({ id: aiRuns.id });
    const [evalRun] = await getDb()
      .insert(aiRuns)
      .values({ kind: "eval", status: "done", params: {} })
      .returning({ id: aiRuns.id });
    const quoted = {
      v: 1,
      model: "gemini-3.5-flash-lite",
      faithfulness: 0.5,
      helpfulness: 3,
      unsupported: ["38% fewer escalations", "since 2019"],
      at: NOW.toISOString(),
    };
    await getDb()
      .insert(aiRunItems)
      .values([
        { runId: old!.id, key: "m_oldjudge01", position: 0, status: "done", result: quoted },
        // Another kind's item is left as it is.
        { runId: evalRun!.id, key: "fact-atlas", position: 0, status: "done", result: quoted },
      ]);
    // The statement DEPLOYMENT.md gives, as psql receives it.
    const scrub = sql.raw(`
      update ai_run_items i
      set result = (i.result - 'unsupported') || jsonb_build_object('unsupported', jsonb_array_length(i.result -> 'unsupported'))
      from ai_runs r
      where i.run_id = r.id and r.kind = 'judge' and jsonb_typeof(i.result -> 'unsupported') = 'array'`);
    await getDb().execute(scrub);
    await getDb().execute(scrub);
    const items = await getDb().select().from(aiRunItems);
    const result = (key: string) => items.find((i) => i.key === key)?.result;
    expect(result("m_oldjudge01")).toEqual({ ...quoted, unsupported: 2 });
    expect(result("fact-atlas")).toEqual(quoted);
  });
});

describe("a night that does not run", () => {
  it("says why, in the audit log, and spends nothing", async () => {
    await seed([{}, {}]);
    // Switched off: the default.
    expect(await startNightly(config, NOW)).toEqual({ refused: "feature_off" });

    await nightlyOn();
    judgeId = "gemini-judge";
    expect(await startNightly(config, NOW)).toEqual({ refused: "no_visitor_judge" });
    judgeId = "gemini-3.5-flash-lite";

    // Another paid run going.
    await getDb().insert(aiRuns).values({ kind: "eval", status: "running", params: {} });
    expect(await startNightly(config, NOW)).toEqual({ refused: "already_running" });
    await getDb().delete(aiRuns);

    // Nothing to judge: answers judged already, by a calibration run whose backup judge answered…
    await getDb()
      .update(aiMessages)
      .set({
        judge: {
          v: 1,
          model: "gemini-backup",
          faithfulness: 1,
          helpfulness: 5,
          unsupported: [],
          at: NOW.toISOString(),
          source: "calibration",
        },
      });
    expect(await startNightly(config, NOW)).toEqual({ refused: "nothing_to_judge" });
    // …or answers that errored or were cut off.
    await getDb().delete(aiMessages);
    await seed([{ finishReason: "error:timeout" }, { finishReason: "aborted" }]);
    expect(await startNightly(config, NOW)).toEqual({ refused: "nothing_to_judge" });

    expect((await nightlyAudit()).map((r) => [r.decision, r.target, r.reason])).toEqual([
      ["denied", yesterday.day, "the nightly judge is switched off"],
      ["denied", yesterday.day, "no judge may read visitor answers (SERVER_AI_JUDGE_MODELS)"],
      ["denied", yesterday.day, "another paid run is going"],
      ["denied", yesterday.day, "no visitor answers to judge that day"],
      ["denied", yesterday.day, "no visitor answers to judge that day"],
    ]);
    expect(judgePrompts).toHaveLength(0);
    expect(await getDb().select().from(aiUsageFeatures)).toHaveLength(0);
    expect(
      await getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(aiRuns),
    ).toEqual([{ n: 0 }]);
  });
});
