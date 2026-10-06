import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import { aiAudit, aiCorpusSnapshots, aiMessages, aiSettings } from "../db/schema.js";
import { FIXTURE_BASE, fixtureConfig } from "../test/ask-fixtures.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import type { CorpusDocument } from "./corpus/build.js";
import { assembleCorpus, type AskCorpus } from "./corpus/index.js";
import { resetRecordedSnapshots } from "./corpus/snapshots.js";
import { assistantState, invalidateAssistantCache } from "./settings.js";
import type { AnswerTrace } from "./trace.js";

/**
 * Plan phase 16: perception, measured, and the corpus tiers the admin
 * applies. The corpus here is assembled as production assembles it, from the
 * stored settings, so an applied tier reaches the next question's core.
 */

const LONG: CorpusDocument = {
  id: "project:long@en",
  kind: "project",
  locale: "en",
  title: "Long",
  url: "/en/work/long",
  text: "A long case study line.\n".repeat(200),
};
const BASE = { ...FIXTURE_BASE, documents: [...FIXTURE_BASE.documents, LONG] };

let config: AskConfig;
let read: AskCorpus | undefined;
/** What is published: a test can take a document down. */
let published = BASE.documents;
const app = createApp({
  ask: {
    config: () => config,
    corpus: async (c) => {
      const { settings, faq } = await assistantState();
      read = assembleCorpus({ ...BASE, documents: published }, settings, faq, c);
      return read;
    },
  },
});

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetRecordedSnapshots();
  config = fixtureConfig();
  read = undefined;
  published = BASE.documents;
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const step = (tokens: { input: number; cached: number }, fetched: string[]) => ({
  model: "gemini-3.5-flash-lite",
  answerOnly: false,
  ttftMs: 100,
  tokens: { ...tokens, output: 10, thoughts: 0 },
  finishReason: "stop",
  passedOver: [],
  tools: fetched.map((id) => ({
    name: "get_document",
    input: JSON.stringify({ id }),
    outcome: "ok" as const,
    resultChars: 100,
  })),
});

async function seed(): Promise<void> {
  await getDb().insert(aiCorpusSnapshots).values({
    key: "snap#1",
    documents: BASE.documents,
    projects: BASE.projects,
    posts: BASE.posts,
    coreTokens: 1,
  });
  const base = {
    locale: "en" as const,
    route: "lite",
    totalMs: 100,
    finishReason: "stop",
    promptVersion: "p",
    sessionHash: "s",
    questionRedacted: "What did he build?",
    corpusKey: "snap#1",
  };
  const perLocale: AnswerTrace = {
    v: 1,
    // Read in English: the German profile was a handle, the English one whole (a re-read).
    steps: [
      step({ input: 1_000, cached: 0 }, ["profile@de"]),
      step({ input: 1_200, cached: 600 }, ["profile@en"]),
    ],
    core: { locale: "en", layout: "locale", tokens: 500 },
    // Its history was trimmed: two earlier questions no longer shown (plan phase 22).
    window: { dropped: 2 },
  };
  const before: AnswerTrace = {
    v: 1,
    // Both languages in one core, as before: the rest of a long project.
    steps: [step({ input: 2_000, cached: 0 }, ["project:long@en"])],
  };
  await getDb()
    .insert(aiMessages)
    .values([
      {
        ...base,
        id: "m_per_locale",
        sessionHash: "s1",
        usd: 0.003,
        tokens: { input: 2_200, cached: 600, output: 20, thoughts: 0 },
        trace: perLocale,
        citedIds: ["profile@en"],
      },
      {
        ...base,
        id: "m_before_cores",
        sessionHash: "s2",
        usd: 0.001,
        tokens: { input: 2_000, cached: 0, output: 10, thoughts: 0 },
        trace: before,
        citedIds: ["project:long@en"],
      },
      // Neither counts: the admin's playground, and an answer from before the window.
      {
        ...base,
        id: "m_playground",
        source: "playground",
        tokens: { input: 9, cached: 0, output: 9, thoughts: 0 },
        trace: before,
      },
      {
        ...base,
        id: "m_last_month",
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        tokens: { input: 9, cached: 0, output: 9, thoughts: 0 },
        trace: before,
      },
    ]);
}

interface PerceptionView {
  days: number;
  answers: number;
  cache: Record<"first" | "later", { steps: number; input: number; cached: number; hits: number }>;
  fetches: Record<string, number>;
  rereadRatio: number | null;
  tokens: { helpful: number; perHelpful: number | null };
  usdPerAnswer: number | null;
  byLayout: Record<
    "both" | "locale",
    {
      answers: number;
      cache: Record<"first" | "later", { steps: number }>;
      fetches: Record<string, number>;
      usdPerAnswer: number | null;
    }
  >;
  localeMix: unknown[];
  documents: { id: string; fetched: number; cited: number }[];
  coreTokens: Record<"en" | "de", number> | null;
  tiers: { promoted: string[]; demoted: string[] };
  suggestions: { promote: unknown[]; demote: unknown[]; considered: { id: string; why: string }[] };
  titles: Record<string, string>;
  tools: { answers: number; tools: unknown[] };
  window: unknown;
}

async function view(query = ""): Promise<PerceptionView> {
  const res = await admin.get(`/admin/assistant/perception${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as PerceptionView;
}

const putTiers = (tiers: { promoted: string[]; demoted: string[] }) =>
  admin.put("/admin/assistant/perception/tiers", tiers);

describe("perception (plan phase 16)", () => {
  it("adds ai_settings.corpus_tiers, empty by default, so an older API's insert still works", async () => {
    await getDb().execute(sql`insert into ai_settings (id) values (1)`);
    const { rows } = await getDb().execute<{ tiers: unknown; type: string; nullable: string }>(sql`
      select s.corpus_tiers as tiers, c.data_type as type, c.is_nullable as nullable
      from ai_settings s, information_schema.columns c
      where c.table_name = 'ai_settings' and c.column_name = 'corpus_tiers'`);
    expect(rows[0]).toEqual({
      tiers: { promoted: [], demoted: [] },
      type: "jsonb",
      nullable: "NO",
    });
  });

  it("measures the window's visitor answers against the cores they read", async () => {
    await seed();
    const p = await view();
    expect(p.days).toBe(30);
    expect(p.answers).toBe(2);
    expect(p.cache.first).toEqual({ steps: 2, input: 3_000, cached: 0, hits: 0 });
    expect(p.cache.later).toEqual({ steps: 1, input: 1_200, cached: 600, hits: 1 });
    expect(p.fetches).toEqual({ whole: 1, rest: 1, handle: 1, unknown: 0 });
    expect(p.rereadRatio).toBeCloseTo(1 / 3);
    expect(p.tokens).toMatchObject({ helpful: 2, perHelpful: (4_200 + 30) / 2 });
    expect(p.usdPerAnswer).toBeCloseTo(0.002);
    // Before and after, apart: the answer without a core in its trace read both languages.
    expect(p.byLayout.locale).toMatchObject({
      answers: 1,
      cache: { first: { steps: 1 }, later: { steps: 1 } },
      fetches: { whole: 1, rest: 0, handle: 1, unknown: 0 },
    });
    expect(p.byLayout.both).toMatchObject({
      answers: 1,
      cache: { first: { steps: 1 }, later: { steps: 0 } },
      fetches: { whole: 0, rest: 1, handle: 0, unknown: 0 },
    });
    expect(p.byLayout.locale.usdPerAnswer).toBeCloseTo(0.003);
    expect(p.byLayout.both.usdPerAnswer).toBeCloseTo(0.001);
    expect(p.documents).toEqual([
      { id: "profile@en", fetched: 1, cited: 1 },
      { id: "project:long@en", fetched: 1, cited: 1 },
      { id: "profile@de", fetched: 1, cited: 0 },
    ]);
    expect(p.coreTokens!.en).toBeGreaterThan(0);
    expect(p.coreTokens!.de).toBeGreaterThan(0);
    expect(p.tiers).toEqual({ promoted: [], demoted: [] });
    // Two answers are far from the floors: everything is only considered.
    expect(p.suggestions.promote).toEqual([]);
    expect(p.suggestions.considered.map((s) => s.id)).toEqual([
      "profile@de",
      "profile@en",
      "project:long@en",
      "*",
    ]);
    expect(p.titles["project:long@en"]).toBe("Long");
    // Plan phase 21: each tool's calls, outcomes and the citations they led to. The German
    // profile was fetched and the English one cited: the same document.
    expect(p.tools).toEqual({
      answers: 2,
      tools: [
        {
          name: "get_document",
          calls: 3,
          callsPerAnswer: 1.5,
          outcomes: { ok: 3 },
          citedAfter: 1,
        },
      ],
    });
    // Plan phase 22: the trimmed session counts; the answer from before the phase, whose
    // trace cannot say, does not.
    expect(p.window).toEqual({
      sessions: 1,
      sessionsTrimmed: 1,
      afterTrim: { answers: 1, rephrased: 0 },
      otherwise: { answers: 0, rephrased: 0 },
    });

    const shorter = await view("?days=1");
    expect(shorter.days).toBe(1);
    expect((await admin.get("/admin/assistant/perception?days=91")).status).toBe(400);
  });

  it("applies tiers the admin chose: stored, audited, and read by the next question's core", async () => {
    const health = async () =>
      ((await (await admin.get("/admin/assistant/health")).json()) as { corpus: { key: string } })
        .corpus.key;
    const keyBefore = await health();
    expect(read!.core.en).toContain('[… continues: get_document("project:long@en")]');

    const res = await putTiers({ promoted: ["project:long@en"], demoted: [] });
    expect(res.status).toBe(200);
    const [stored] = await getDb().select().from(aiSettings).where(eq(aiSettings.id, 1));
    expect(stored!.corpusTiers).toEqual({ promoted: ["project:long@en"], demoted: [] });

    const keyAfter = await health();
    expect(keyAfter).not.toBe(keyBefore);
    // Whole, and right after the profile.
    expect(read!.core.en).not.toContain("continues: get_document");
    expect(read!.core.en.indexOf("id: project:long@en")).toBeLessThan(
      read!.core.en.indexOf("id: project:atlas@en"),
    );
    expect(read!.documents.find((d) => d.id === "project:long@en")?.tier).toBe("promoted");
    expect((await view()).tiers.promoted).toEqual(["project:long@en"]);

    expect((await putTiers({ promoted: [], demoted: ["project:atlas@en"] })).status).toBe(200);
    expect(await health()).not.toBe(keyAfter);
    const log = await getDb()
      .select({ actor: aiAudit.actor, action: aiAudit.action, reason: aiAudit.reason })
      .from(aiAudit)
      .orderBy(asc(aiAudit.id));
    expect(log).toEqual([
      { actor: "admin", action: "corpus.tiers", reason: "promoted +project:long@en" },
      {
        actor: "admin",
        action: "corpus.tiers",
        reason: "promoted −project:long@en; demoted +project:atlas@en",
      },
    ]);

    expect((await putTiers({ promoted: [], demoted: [] })).status).toBe(200);
    expect(await health()).toBe(keyBefore);
  });

  it("drops a stored tier whose document is no longer published, and still refuses a new unknown one", async () => {
    expect((await putTiers({ promoted: ["project:long@en"], demoted: [] })).status).toBe(200);
    published = FIXTURE_BASE.documents;
    // The page still lists the old tier and sends it with the next change.
    const res = await putTiers({ promoted: ["project:long@en"], demoted: ["project:atlas@en"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tiers: { promoted: [], demoted: ["project:atlas@en"] },
      dropped: ["project:long@en"],
    });
    const [last] = await getDb()
      .select({ reason: aiAudit.reason })
      .from(aiAudit)
      .orderBy(asc(aiAudit.id))
      .offset(1);
    expect(last!.reason).toBe(
      "promoted −project:long@en; demoted +project:atlas@en; no longer published: project:long@en",
    );
    const refused = await putTiers({ promoted: ["project:gone@en"], demoted: [] });
    expect(refused.status).toBe(400);
  });

  it("refuses unknown documents, both tiers at once, a document that cannot be cut, too many, and visitors", async () => {
    const refused = async (tiers: { promoted: string[]; demoted: string[] }, error: string) => {
      const res = await putTiers(tiers);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(error);
    };
    await refused({ promoted: ["project:nova@en"], demoted: [] }, "unknown_document");
    await refused({ promoted: ["project:long@en"], demoted: ["project:long@en"] }, "both_tiers");
    await refused({ promoted: [], demoted: ["profile@en"] }, "not_demotable");
    await refused(
      { promoted: Array.from({ length: 7 }, (_, i) => `x${i}`), demoted: [] },
      "invalid_input",
    );
    expect(await getDb().select().from(aiAudit)).toEqual([]);

    const visitor = new TestClient(app);
    expect((await visitor.get("/admin/assistant/perception")).status).toBe(401);
    expect(
      (await visitor.put("/admin/assistant/perception/tiers", { promoted: [], demoted: [] }))
        .status,
    ).toBe(401);
  });
});
