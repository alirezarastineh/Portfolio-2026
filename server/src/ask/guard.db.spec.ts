import { beforeEach, describe, expect, it } from "vitest";
import { asc, sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiMessages, aiRuns, aiSettings, aiUsage, aiUsageFeatures } from "../db/schema.js";
import {
  eventually,
  fixtureConfig,
  fixtureCorpus,
  readUiChunks,
  uiText,
} from "../test/ask-fixtures.js";
import { generating, mockEntry, scripted, textTurn, usage } from "../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import type { Feature } from "./features.js";
import { utcDay } from "./guard.js";
import type { ModelCall } from "./models/fallback.js";
import { resetBreakers } from "./models/circuit.js";
import { invalidateAssistantCache } from "./settings.js";
import { recordUsage } from "./usage.js";

/**
 * Plan phase 13: spend split by feature, and fenced. Visitors keep a share of
 * the day's budget whatever the admin's tools and runs spend; each of those
 * stops at that line, at its own cap, or at its switch.
 */

let config: AskConfig;
const answers = () => scripted([textTurn("Atlas cut escalations by 38% [^project:atlas@en].")]);
let lite = answers();
let copilot = generating(["Kurz."]);

const app = createApp({
  ask: {
    config: () => config,
    chain: (_config, role) => [
      role === "copilot" || role === "insight"
        ? mockEntry("gemini-3.5-flash-lite", copilot.model)
        : mockEntry("gemini-3.5-flash-lite", lite.model),
    ],
    corpus: async (c) => fixtureCorpus(c),
    draftCorpus: async (c) => fixtureCorpus(c),
    evalPacing: null,
  },
});

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig({ dailyBudgetUsd: 2 });
  lite = answers();
  copilot = generating(["Kurz."]);
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

/** Spend already recorded today, as `recordUsage` writes it, to the cent. */
async function spent(feature: Feature, usd: number) {
  const model = `sim-${feature}`;
  await getDb().insert(aiUsage).values({ day: utcDay(), model, requests: 1, usd });
  await getDb().insert(aiUsageFeatures).values({ day: utcDay(), feature, model, requests: 1, usd });
}

const call = (model: string, input = 1_000_000): ModelCall => ({
  model,
  answerOnly: false,
  ttftMs: 10,
  usage: usage(input, 0),
  finishReason: "stop",
});

let ip = 0;
function ask(text: string) {
  ip++;
  return app.request("/v1/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip}` },
    body: JSON.stringify({
      sessionId: "tab-session-0000000013",
      locale: "en",
      messages: [{ id: `u${ip}`, role: "user", parts: [{ type: "text", text }] }],
    }),
  });
}

const copilotRequest = () =>
  admin.post("/admin/ai/copilot", { task: "tighten", text: "Kurz und knapp.", locale: "de" });

describe("migration 0015: usage per feature and the fence settings", () => {
  it("adds ai_usage_features and the settings' reserve, caps and switches", async () => {
    const { rows: keys } = await getDb().execute<{ column_name: string }>(sql`
      select k.column_name from information_schema.table_constraints c
      join information_schema.key_column_usage k on k.constraint_name = c.constraint_name
      where c.table_name = 'ai_usage_features' and c.constraint_type = 'PRIMARY KEY'
      order by k.ordinal_position`);
    expect(keys.map((k) => k.column_name)).toEqual(["day", "feature", "model"]);

    const { rows } = await getDb().execute<{ column_name: string; column_default: string }>(sql`
      select column_name, column_default from information_schema.columns
      where table_name = 'ai_settings'
        and column_name in ('public_reserve', 'feature_caps', 'feature_switches')
      order by column_name`);
    expect(rows).toEqual([
      { column_name: "feature_caps", column_default: "'{}'::jsonb" },
      { column_name: "feature_switches", column_default: "'{}'::jsonb" },
      { column_name: "public_reserve", column_default: "0.5" },
    ]);
  });

  it("still takes the previous API's insert, and a save from the previous admin keeps the fences", async () => {
    // Deploys go API first: until then the old API writes settings like these.
    await getDb().execute(sql`
      insert into ai_settings (id, enabled, daily_budget_usd, deep_enabled)
      values (1, true, 3, true)`);
    const [row] = await getDb().select().from(aiSettings);
    expect(row).toMatchObject({ publicReserve: 0.5, featureCaps: {}, featureSwitches: {} });

    const fenced = await admin.put("/admin/assistant/settings", {
      enabled: true,
      dailyBudgetUsd: 3,
      deepEnabled: true,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
      publicReserve: 0.7,
      featureCaps: { eval: 0.5, copilot: 0.1 },
      featureSwitches: { copilot: false },
    });
    expect(fenced.status).toBe(200);

    // The previous admin sends none of the new keys: they stay as they were.
    const old = await admin.put("/admin/assistant/settings", {
      enabled: true,
      dailyBudgetUsd: 4,
      deepEnabled: false,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
    });
    expect(old.status).toBe(200);
    const { settings } = (await old.json()) as {
      settings: {
        dailyBudgetUsd: number;
        publicReserve: number;
        featureCaps: Record<string, number | null>;
        featureSwitches: Record<string, boolean>;
      };
    };
    expect(settings.dailyBudgetUsd).toBe(4);
    expect(settings.publicReserve).toBe(0.7);
    expect(settings.featureCaps).toMatchObject({ eval: 0.5, copilot: 0.1, pairwise: null });
    expect(settings.featureSwitches).toMatchObject({ copilot: false, judge: true, agent: false });

    // A partial patch merges: one cap removed, the rest kept.
    await admin.put("/admin/assistant/settings", {
      enabled: true,
      dailyBudgetUsd: 4,
      deepEnabled: false,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
      featureCaps: { copilot: null },
    });
    const [merged] = await getDb().select().from(aiSettings);
    expect(merged!.featureCaps).toEqual({ eval: 0.5, copilot: null });

    const tooMuch = await admin.put("/admin/assistant/settings", {
      enabled: true,
      dailyBudgetUsd: 4,
      deepEnabled: false,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
      publicReserve: 0.95,
    });
    expect(tooMuch.status).toBe(400);
  });
});

describe("usage per feature", () => {
  it("records each feature's calls apart, and their sum as the day's total", async () => {
    await recordUsage([call("gemini-3.5-flash-lite")], "terminal");
    await recordUsage([call("gemini-3.5-flash-lite"), call("gemini-3.7-flash")], "eval");

    const total = await getDb().select().from(aiUsage).orderBy(asc(aiUsage.model));
    expect(total.map((r) => [r.model, r.requests])).toEqual([
      ["gemini-3.5-flash-lite", 2],
      ["gemini-3.7-flash", 1],
    ]);
    const split = await getDb()
      .select()
      .from(aiUsageFeatures)
      .orderBy(asc(aiUsageFeatures.feature), asc(aiUsageFeatures.model));
    expect(split.map((r) => [r.feature, r.model, r.requests])).toEqual([
      ["eval", "gemini-3.5-flash-lite", 1],
      ["eval", "gemini-3.7-flash", 1],
      ["terminal", "gemini-3.5-flash-lite", 1],
    ]);
    const sum = (rows: { usd: number }[]) => rows.reduce((s, r) => s + r.usd, 0);
    expect(sum(split)).toBeCloseTo(sum(total), 12);
    expect(sum(total)).toBeGreaterThan(0);
  });

  it("keeps the day's total when the split by feature cannot be written", async () => {
    await getDb().execute(sql`alter table ai_usage_features rename to ai_usage_features_away`);
    try {
      await expect(
        recordUsage([call("gemini-3.5-flash-lite")], "copilot"),
      ).resolves.toBeUndefined();
    } finally {
      await getDb().execute(sql`alter table ai_usage_features_away rename to ai_usage_features`);
    }
    expect(await getDb().select().from(aiUsage)).toHaveLength(1);
    expect(await getDb().select().from(aiUsageFeatures)).toHaveLength(0);
  });

  it("adds up answers recorded at once, whatever order their models come in", async () => {
    const models = ["gemini-3.5-flash-lite", "gemini-3.7-flash", "gemini-3.1-flash-lite"];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const order = i % 2 ? models : [...models].reverse();
        return recordUsage(
          order.map((m) => call(m, 1_000)),
          i % 3 ? "terminal" : "copilot",
        );
      }),
    );
    const total = await getDb().select().from(aiUsage);
    expect(total.map((r) => r.requests)).toEqual([12, 12, 12]);
    const split = await getDb().select().from(aiUsageFeatures);
    expect(split.reduce((n, r) => n + r.requests, 0)).toBe(36);
  });
});

describe("the fences", () => {
  it("stops eval spend at the reserve line while the terminal keeps answering", async () => {
    // Half of $2 is kept for visitors: an eval spend of $1 reaches the line.
    await spent("eval", 1);

    const run = await admin.post("/admin/assistant/runs", {
      kind: "eval",
      cases: ["fact-atlas-impact"],
    });
    expect(run.status).toBe(503);
    expect(await run.json()).toEqual({ error: "reserve_reached" });
    expect(await getDb().select().from(aiRuns)).toHaveLength(0);

    const oneRequest = await admin.post("/admin/assistant/evals", { cases: ["fact-atlas-impact"] });
    expect(oneRequest.status).toBe(503);
    expect(await oneRequest.json()).toEqual({ error: "reserve_reached" });

    // Every other admin tool stops at the same line.
    expect(await (await copilotRequest()).json()).toEqual({ error: "reserve_reached" });
    await getDb()
      .insert(aiMessages)
      .values({
        id: "m_q00000013",
        sessionHash: "s",
        locale: "en",
        route: "lite",
        questionRedacted: "What is his notice period?",
        totalMs: 1,
        tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
        finishReason: "stop",
        promptVersion: "p",
      });
    const insights = await admin.post("/admin/assistant/insights");
    expect(await insights.json()).toEqual({ error: "reserve_reached" });
    const playground = await admin.post("/admin/assistant/playground", {
      sessionId: "tab-session-0000000013",
      locale: "en",
      messages: [{ id: "p1", role: "user", parts: [{ type: "text", text: "What is Atlas?" }] }],
    });
    expect(await playground.json()).toEqual({ error: "reserve_reached" });
    expect(copilot.calls).toHaveLength(0);

    // The terminal answers, and its spend goes on the day as the terminal's.
    const res = await ask("What did Atlas achieve?");
    expect(res.status).toBe(200);
    expect(uiText(await readUiChunks(res))).toContain("38%");
    const terminal = await eventually(async () => {
      const rows = await getDb()
        .select()
        .from(aiUsageFeatures)
        .where(sql`${aiUsageFeatures.feature} = 'terminal'`);
      return rows.length ? rows : undefined;
    });
    expect(terminal).toHaveLength(1);

    const health = (await (await admin.get("/admin/assistant/health")).json()) as {
      state: { state: string };
      spend: {
        totalUsd: number;
        reserveLineUsd: number;
        features: { feature: string; spentUsd: number; state: string }[];
      };
    };
    expect(health.state.state).toBe("ok");
    expect(health.spend.reserveLineUsd).toBe(1);
    const states = Object.fromEntries(health.spend.features.map((f) => [f.feature, f.state]));
    expect(states).toMatchObject({
      terminal: "ok",
      eval: "reserve",
      copilot: "reserve",
      agent: "off",
    });
    expect(health.spend.features.find((f) => f.feature === "eval")!.spentUsd).toBe(1);
  });

  it("stops a feature at its cap and at its switch, and leaves the others alone", async () => {
    const base = {
      enabled: true,
      dailyBudgetUsd: null,
      deepEnabled: true,
      suggestedQuestions: { en: [], de: [] },
      systemCard: { en: "", de: "" },
    };
    await admin.put("/admin/assistant/settings", { ...base, featureCaps: { copilot: 0.05 } });
    await spent("copilot", 0.05);

    const capped = await copilotRequest();
    expect(capped.status).toBe(503);
    expect(await capped.json()).toEqual({ error: "cap_reached" });

    // The cap is the copilot's own: the playground still answers.
    const playground = await admin.post("/admin/assistant/playground", {
      sessionId: "tab-session-0000000013",
      locale: "en",
      messages: [{ id: "p1", role: "user", parts: [{ type: "text", text: "What is Atlas?" }] }],
    });
    expect(playground.status).toBe(200);
    await readUiChunks(playground);

    await admin.put("/admin/assistant/settings", {
      ...base,
      featureCaps: { copilot: null },
      featureSwitches: { copilot: false },
    });
    const off = await copilotRequest();
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ error: "feature_off" });

    await admin.put("/admin/assistant/settings", { ...base, featureSwitches: { copilot: true } });
    const on = await copilotRequest();
    expect(on.status).toBe(200);
    expect(copilot.calls).toHaveLength(1);
    const own = await getDb()
      .select()
      .from(aiUsageFeatures)
      .where(
        sql`${aiUsageFeatures.feature} = 'copilot' and ${aiUsageFeatures.model} <> 'sim-copilot'`,
      );
    expect(own).toHaveLength(1);
  });
});
