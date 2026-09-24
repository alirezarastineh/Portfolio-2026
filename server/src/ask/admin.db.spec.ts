import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiFeedback, aiMessages, aiUsage } from "../db/schema.js";
import {
  eventually,
  FIXTURE_BASE,
  fixtureConfig,
  fixtureCorpus,
  readUiChunks,
  uiText,
} from "../test/ask-fixtures.js";
import {
  generating,
  mockEntry,
  scripted,
  textTurn,
  type ScriptedModel,
} from "../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import { assembleCorpus } from "./corpus/index.js";
import { utcDay } from "./guard.js";
import { resetBreakers } from "./models/circuit.js";
import type { ChainRole } from "./models/registry.js";
import { DEFAULT_SETTINGS, invalidateAssistantCache } from "./settings.js";

let config: AskConfig;
let models: Partial<Record<ChainRole, ScriptedModel>> = {};

const app = createApp({
  ask: {
    config: () => config,
    chain: (_c, role) => {
      const m = models[role] ?? models.lite;
      return m ? [mockEntry("gemini-3.5-flash-lite", m.model)] : [];
    },
    corpus: async (c) => fixtureCorpus(c),
    // The playground's draft: a project the published corpus does not have yet.
    draftCorpus: async (c) =>
      assembleCorpus(
        {
          ...FIXTURE_BASE,
          key: "draft:x",
          documents: [
            ...FIXTURE_BASE.documents,
            {
              id: "project:nova@en",
              kind: "project",
              locale: "en",
              title: "Nova",
              url: "/en/work/nova",
              text: "Nova — unpublished draft project",
            },
          ],
        },
        DEFAULT_SETTINGS,
        [],
        c,
      ),
  },
});

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig();
  models = {};
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

describe("admin assistant API", () => {
  it("is admin-only", async () => {
    const anonymous = new TestClient(app);
    expect((await anonymous.get("/admin/assistant/settings")).status).toBe(401);
    expect((await anonymous.post("/admin/assistant/playground", {})).status).toBe(401);
  });

  it("saves settings, which the public config then reflects", async () => {
    const initial = (await (await admin.get("/admin/assistant/settings")).json()) as {
      settings: { enabled: boolean };
      env: { keys: { gemini: boolean }; chains: { lite: { id: string }[] } };
    };
    expect(initial.settings.enabled).toBe(true);
    expect(initial.env.keys.gemini).toBe(true);
    expect(initial.env.chains.lite[0]).toBeUndefined(); // no model scripted for this test

    const res = await admin.put("/admin/assistant/settings", {
      enabled: true,
      dailyBudgetUsd: 0.5,
      deepEnabled: false,
      suggestedQuestions: { en: ["What is Atlas?"], de: ["Was ist Atlas?"] },
      systemCard: { en: "Custom card.", de: "" },
    });
    expect(res.status).toBe(200);

    const publicConfig = (await (await app.request("/v1/ask/config")).json()) as Record<
      string,
      unknown
    >;
    expect(publicConfig).toMatchObject({ deep: false, suggestions: { en: ["What is Atlas?"] } });

    expect(
      (await admin.put("/admin/assistant/settings", { enabled: true, dailyBudgetUsd: 5000 }))
        .status,
    ).toBe(400);
  });

  it("manages FAQ entries and their order", async () => {
    const created = await admin.post("/admin/assistant/faq", {
      isVisible: true,
      translations: { en: { question: "Notice period?", answer: "One month." } },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const second = (await (
      await admin.post("/admin/assistant/faq", {
        isVisible: false,
        translations: { de: { question: "Umzug?", answer: "Innerhalb der EU." } },
      })
    ).json()) as { id: string };

    expect(
      (
        await admin.put(`/admin/assistant/faq/${id}`, {
          isVisible: true,
          translations: {
            en: { question: "Notice period?", answer: "Four weeks." },
            de: { question: "Frist?", answer: "Vier Wochen." },
          },
        })
      ).status,
    ).toBe(200);
    expect((await admin.patch("/admin/assistant/faq-order", { ids: [second.id, id] })).status).toBe(
      200,
    );

    const { faq } = (await (await admin.get("/admin/assistant/faq")).json()) as {
      faq: { id: string; translations: Record<string, { answer: string }> }[];
    };
    expect(faq.map((f) => f.id)).toEqual([second.id, id]);
    expect(faq[1]!.translations["de"]!.answer).toBe("Vier Wochen.");

    expect((await admin.delete(`/admin/assistant/faq/${id}`)).status).toBe(200);
    expect((await admin.delete(`/admin/assistant/faq/${id}`)).status).toBe(404);
    expect(
      (await admin.post("/admin/assistant/faq", { isVisible: true, translations: {} })).status,
    ).toBe(400);
  });

  it("answers from the draft in the playground, logged apart from visitors", async () => {
    models.lite = scripted([textTurn("Nova is a draft [^project:nova@en].")]);
    const res = await admin.post("/admin/assistant/playground", {
      sessionId: "admin-playground-0001",
      locale: "en",
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "What is Nova?" }] }],
    });
    expect(res.status).toBe(200);
    const chunks = await readUiChunks(res);
    expect(uiText(chunks)).toBe("Nova is a draft [^project:nova@en].");

    const row = await eventually(async () => (await getDb().select().from(aiMessages))[0]);
    expect(row.source).toBe("playground");

    const visitors = (await (await admin.get("/admin/assistant/conversations")).json()) as {
      messages: unknown[];
    };
    expect(visitors.messages).toHaveLength(0);
    const playground = (await (
      await admin.get("/admin/assistant/conversations?source=playground")
    ).json()) as {
      messages: { question: string }[];
    };
    expect(playground.messages[0]!.question).toBe("What is Nova?");
  });

  it("filters conversations by thumbs-down and by answers that did not know", async () => {
    const base = {
      sessionHash: "s",
      locale: "en" as const,
      route: "lite",
      totalMs: 100,
      tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "p",
    };
    await getDb()
      .insert(aiMessages)
      .values([
        {
          ...base,
          id: "m_a00000001",
          questionRedacted: "salary?",
          answerExcerpt: "That is not in the portfolio.",
        },
        {
          ...base,
          id: "m_b00000001",
          questionRedacted: "stack?",
          answerExcerpt: "Python and Angular.",
        },
        { ...base, id: "m_c00000001", questionRedacted: "where?", answerExcerpt: "Berlin." },
      ]);
    await getDb().insert(aiFeedback).values({ messageId: "m_c00000001", value: -1 });

    const list = async (filter: string) =>
      (
        (await (await admin.get(`/admin/assistant/conversations?filter=${filter}`)).json()) as {
          messages: { id: string; feedback: number | null }[];
        }
      ).messages.map((m) => m.id);
    expect(await list("unknown")).toEqual(["m_a00000001"]);
    expect(await list("down")).toEqual(["m_c00000001"]);
    expect(await list("all")).toHaveLength(3);
  });

  it("reports usage per day and model, and health", async () => {
    await getDb().insert(aiUsage).values({
      day: utcDay(),
      model: "gemini-3.5-flash-lite",
      requests: 3,
      inputTokens: 900,
      cachedInputTokens: 600,
      usd: 0.01,
    });
    const usage = (await (await admin.get("/admin/assistant/usage?days=7")).json()) as {
      models: { model: string; cachedInputTokens: number }[];
    };
    expect(usage.models).toEqual([
      expect.objectContaining({ model: "gemini-3.5-flash-lite", cachedInputTokens: 600 }),
    ]);

    const health = (await (await admin.get("/admin/assistant/health")).json()) as {
      state: { state: string };
      corpus: { documents: Record<string, number>; coreTokens: number };
    };
    expect(health.state.state).toBe("ok");
    expect(health.corpus.documents["project"]).toBe(1);
    expect(health.corpus.coreTokens).toBeGreaterThan(0);
  });

  it("runs the copilot through the same chain and counts its cost", async () => {
    models.copilot = generating(["<p>Hallo <strong>Welt</strong></p>"]);
    const res = await admin.post("/admin/ai/copilot", {
      task: "translate",
      text: "<p>Hello <strong>world</strong></p>",
      from: "en",
      to: "de",
      html: true,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "<p>Hallo <strong>Welt</strong></p>" });
    expect(JSON.stringify(models.copilot.calls[0]!.prompt)).toContain("keep every tag");

    const [usage] = await getDb().select().from(aiUsage);
    expect(usage).toMatchObject({ requests: 1, inputTokens: 50 });

    models.copilot = generating(["A".repeat(400)]);
    const seo = (await (
      await admin.post("/admin/ai/copilot", {
        task: "seo",
        text: "Long case study",
        locale: "en",
        maxLength: 155,
      })
    ).json()) as { text: string };
    expect(seo.text.length).toBeLessThanOrEqual(155);
  });

  it("groups visitor questions into topics", async () => {
    await getDb()
      .insert(aiMessages)
      .values({
        id: "m_q00000001",
        sessionHash: "s",
        locale: "en",
        route: "lite",
        questionRedacted: "What is his notice period?",
        answerExcerpt: "That is not in the portfolio.",
        totalMs: 1,
        tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
        finishReason: "stop",
        promptVersion: "p",
      });
    models.insight = generating([
      JSON.stringify({
        topics: [
          {
            title: "Notice period",
            summary: "Recruiters ask when he can start.",
            questions: 1,
            examples: ["What is his notice period?"],
            unanswered: true,
          },
        ],
      }),
    ]);
    const res = await admin.post("/admin/assistant/insights");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      topics: { title: string; unanswered: boolean }[];
      analysed: number;
    };
    expect(body).toMatchObject({
      analysed: 1,
      topics: [{ title: "Notice period", unanswered: true }],
    });
    expect(JSON.stringify(models.insight.calls[0]!.prompt)).toContain("[not answered]");
  });
});
