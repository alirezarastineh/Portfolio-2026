import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../../app.js";
import { getDb } from "../../db/client.js";
import { aiSkillUses, aiUsageFeatures } from "../../db/schema.js";
import { fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import {
  apiError,
  failing,
  generating,
  mockEntry,
  replying,
  type ScriptedModel,
} from "../../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import type { AskConfig } from "../config.js";
import { resetRecordedSnapshots } from "../corpus/snapshots.js";
import { resetBreakers } from "../models/circuit.js";
import { invalidateAssistantCache } from "../settings.js";
import { skillFor } from "./registry.js";

let config: AskConfig;
let copilot: ScriptedModel | null = null;
/** The judge chain: it ranks explored drafts and reads translations (plan phase 28). */
let judge: ScriptedModel | null = null;

const app = createApp({
  ask: {
    config: () => config,
    chain: (_c, role) =>
      role === "copilot" && copilot
        ? [mockEntry("gemini-3.5-flash-lite", copilot.model)]
        : role === "judge" && judge
          ? [mockEntry("gemini-3.7-flash", judge.model)]
          : [],
    corpus: async (c) => fixtureCorpus(c),
  },
});

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  resetRecordedSnapshots();
  config = fixtureConfig();
  copilot = null;
  judge = null;
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

afterEach(() => vi.restoreAllMocks());

const tighten = {
  task: "tighten",
  text: "A long and winding sentence about search.",
  locale: "en",
};

async function draft(body: Record<string, unknown>, text: string) {
  copilot = generating([text]);
  const res = await admin.post("/admin/ai/copilot", body);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const uses = () => getDb().select().from(aiSkillUses);

/** Drafts as the editor's verdicts would leave them, for the table. */
async function seed(
  skill: string,
  version: string,
  rows: {
    outcome: "kept" | "edited" | "discarded" | "abstained" | null;
    distance?: number;
    source?: "copilot" | "agent";
  }[],
) {
  await getDb()
    .insert(aiSkillUses)
    .values(
      rows.map((row) => ({
        skill,
        version,
        source: row.source ?? "copilot",
        model: "gemini-3.5-flash-lite",
        words: 20,
        outcome: row.outcome,
        editDistance: row.outcome === "kept" ? 0 : (row.distance ?? null),
        decidedAt: row.outcome ? new Date() : null,
      })),
    );
}

const times = <T>(n: number, row: T): T[] => Array.from({ length: n }, () => row);

describe("the copilot's drafts (plan phase 27)", () => {
  it("records a draft with its skill's version and model, and returns its id", async () => {
    const { status, body } = await draft(
      { task: "translate", text: "Search, briefly and sharply.", from: "en", to: "de" },
      "Suche, kurz und scharf.",
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      text: "Suche, kurz und scharf.",
      model: "gemini-3.5-flash-lite",
      suggestionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(await uses()).toEqual([
      expect.objectContaining({
        id: body.suggestionId,
        skill: "translate",
        version: skillFor("translate").version,
        source: "copilot",
        model: "gemini-3.5-flash-lite",
        words: 4,
        repairs: 0,
        flags: [],
        candidates: 1,
        critic: null,
        outcome: null,
        editDistance: null,
        decidedAt: null,
      }),
    ]);
    // Its spend stays the copilot's.
    expect(await getDb().select().from(aiUsageFeatures)).toEqual([
      expect.objectContaining({ feature: "copilot", requests: 1 }),
    ]);
  });

  it("records an FAQ draft that finds no answer as abstained, with nothing to report", async () => {
    const { status, body } = await draft(
      { task: "faq-answer", question: "What is his shoe size?", locale: "en" },
      "NO_ANSWER",
    );
    expect(status).toBe(200);
    expect(body).toEqual({ text: "NO_ANSWER", model: "gemini-3.5-flash-lite" });
    const [use] = await uses();
    expect(use).toMatchObject({ skill: "faq-answer", outcome: "abstained", words: 1 });
    expect(use!.decidedAt).toBeInstanceOf(Date);
  });

  it("records nothing when no model is asked, or none answers", async () => {
    const same = await draft({ task: "translate", text: "Same", from: "en", to: "en" }, "x");
    expect(same).toEqual({ status: 200, body: { text: "Same" } });
    expect(copilot!.calls).toHaveLength(0);

    vi.spyOn(console, "error").mockImplementation(() => {});
    copilot = failing(apiError(500));
    const down = await admin.post("/admin/ai/copilot", tighten);
    expect(down.status).toBe(503);
    expect(await uses()).toEqual([]);
  });

  it("offers nothing, and records nothing, when a safety filter stopped every draft", async () => {
    copilot = replying(() => ({ text: "", stop: "content-filter" }));
    const empty = await admin.post("/admin/ai/copilot", {
      task: "translate",
      text: "Search, briefly.",
      from: "en",
      to: "de",
    });
    expect(empty.status).toBe(502);
    expect(await empty.json()).toEqual({ error: "empty_draft" });
    expect(await uses()).toEqual([]);
  });

  it("still gives the draft when it cannot be recorded", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await getDb().execute(sql`alter table ai_skill_uses rename to ai_skill_uses_away`);
    try {
      const { status, body } = await draft(
        { task: "translate", text: "Search, briefly.", from: "en", to: "de" },
        "Suche, kurz.",
      );
      expect(status).toBe(200);
      expect(body).toEqual({ text: "Suche, kurz.", model: "gemini-3.5-flash-lite" });
      expect(logged).toHaveBeenCalledWith("[ask] copilot draft not recorded", expect.anything());
    } finally {
      await getDb().execute(sql`alter table ai_skill_uses_away rename to ai_skill_uses`);
    }
  });
});

describe("the editor's verdicts", () => {
  it("decides each draft once, and skips one it does not know", async () => {
    const ids: string[] = [];
    for (const text of ["One draft here.", "Another draft here.", "A third draft."]) {
      ids.push((await draft(tighten, text)).body.suggestionId as string);
    }
    const unknown = "00000000-0000-4000-8000-0000000000ff";
    const res = await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [
        { id: ids[0], outcome: "kept" },
        { id: ids[1], outcome: "edited", distance: 3 },
        { id: ids[2], outcome: "discarded", distance: null },
        { id: unknown, outcome: "kept" },
      ],
    });
    expect(await res.json()).toEqual({ recorded: 3 });

    const again = await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [{ id: ids[0], outcome: "discarded", distance: 9 }],
    });
    expect(await again.json()).toEqual({ recorded: 0 });

    const decided = new Map((await uses()).map((u) => [u.id, u]));
    expect(decided.get(ids[0]!)).toMatchObject({ outcome: "kept", editDistance: 0 });
    expect(decided.get(ids[1]!)).toMatchObject({ outcome: "edited", editDistance: 3 });
    expect(decided.get(ids[2]!)).toMatchObject({ outcome: "discarded", editDistance: null });
    for (const id of ids) expect(decided.get(id)!.decidedAt).toBeInstanceOf(Date);
  });

  it("never turns an abstention into a verdict", async () => {
    await draft({ task: "faq-answer", question: "His shoe size?", locale: "de" }, "NO_ANSWER");
    const [use] = await uses();
    const res = await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [{ id: use!.id, outcome: "kept" }],
    });
    expect(await res.json()).toEqual({ recorded: 0 });
    expect((await uses())[0]).toMatchObject({ outcome: "abstained" });
  });

  it("refuses a verdict it cannot read", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const outcomes of [
      [],
      [{ id, outcome: "edited", distance: 0 }],
      [{ id, outcome: "edited" }],
      [{ id, outcome: "kept", distance: "a lot" }],
      [{ id: "not-a-uuid", outcome: "kept" }],
      [{ id, outcome: "abstained" }],
      times(51, { id, outcome: "kept" }),
    ]) {
      const res = await admin.post("/admin/ai/copilot/outcomes", { outcomes });
      expect(res.status, JSON.stringify(outcomes).slice(0, 80)).toBe(400);
    }
  });
});

describe("the skills' table", () => {
  it("shows keep rates per version from drafts decided (the done-when)", async () => {
    const current = skillFor("tighten").version;
    await seed("tighten", current, [
      ...times(3, { outcome: "kept" as const }),
      // Their median is 2 words; their mean 4, their least 1, their most 9.
      { outcome: "edited", distance: 1 },
      { outcome: "edited", distance: 9 },
      { outcome: "edited", distance: 2 },
      ...times(8, { outcome: "discarded" as const, distance: 30 }),
      ...times(2, { outcome: null }),
      // The content agent's (plan phase 29) count apart.
      ...times(5, { outcome: "kept" as const, source: "agent" as const }),
    ]);
    await seed("tighten", "0123456789ab", times(10, { outcome: "kept" as const }));
    await seed("faq-answer", skillFor("faq-answer").version, [
      ...times(3, { outcome: "abstained" as const }),
      { outcome: "kept" },
    ]);

    const res = await admin.get("/admin/ai/skills");
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      rules: { keepFloor: number; minimumDecided: number };
      skills: {
        id: string;
        version: string;
        versions: Record<string, unknown>[];
        agent: Record<string, unknown>[];
      }[];
    };
    expect(view.rules).toEqual({ keepFloor: 0.5, minimumDecided: 10 });
    expect(view.skills.map((s) => s.id)).toEqual([
      "translate",
      "tighten",
      "seo",
      "faq-question",
      "faq-answer",
      "alt",
      "describe",
    ]);
    const byId = new Map(view.skills.map((s) => [s.id, s]));

    const [now, before] = byId.get("tighten")!.versions;
    expect(now).toMatchObject({
      version: current,
      current: true,
      uses: 16,
      kept: 3,
      edited: 3,
      discarded: 8,
      waiting: 2,
      decided: 14,
      keepRate: 6 / 14,
      editRate: 3 / 14,
      medianEdit: 2,
      flagged: true,
    });
    expect(before).toMatchObject({
      version: "0123456789ab",
      current: false,
      keepRate: 1,
      flagged: false,
    });
    // The content agent's drafts, in rows of their own.
    expect(byId.get("tighten")!.agent).toEqual([
      expect.objectContaining({ version: current, current: true, uses: 5, kept: 5, keepRate: 1 }),
    ]);
    expect(byId.get("faq-answer")!.agent).toEqual([]);
    expect(byId.get("faq-answer")!.versions).toEqual([
      expect.objectContaining({ abstained: 3, decided: 1, keepRate: 1 }),
    ]);
    // A skill nobody used yet: its current version, with nothing to rate.
    expect(byId.get("translate")!.versions).toEqual([
      expect.objectContaining({
        version: skillFor("translate").version,
        uses: 0,
        keepRate: null,
        first: null,
        flagged: false,
      }),
    ]);
  });

  it("takes a draft saved as it is into the table as kept", async () => {
    const { body } = await draft(
      { task: "seo", text: "<p>Atlas, a retrieval system.</p>", locale: "en" },
      "Atlas: retrieval over two million documents for support teams.",
    );
    await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [{ id: body.suggestionId, outcome: "kept" }],
    });
    const view = (await (await admin.get("/admin/ai/skills")).json()) as {
      skills: { id: string; versions: Record<string, unknown>[] }[];
    };
    expect(view.skills.find((s) => s.id === "seo")!.versions[0]).toMatchObject({
      current: true,
      uses: 1,
      kept: 1,
      decided: 1,
      keepRate: 1,
      editRate: 0,
    });
  });

  it("is the admin's alone", async () => {
    const anonymous = new TestClient(app);
    expect((await anonymous.post("/admin/ai/copilot", tighten)).status).toBe(401);
    expect((await anonymous.post("/admin/ai/copilot/outcomes", { outcomes: [] })).status).toBe(401);
    expect((await anonymous.get("/admin/ai/skills")).status).toBe(401);
  });
});

const LONG =
  "Built a retrieval system over two million documents with pgvector, cut support escalations by 38 % in a year, and moved the team from weekly releases to shipping several times a day.";
const LONG_DE =
  "Baute ein Retrievalsystem über zwei Millionen Dokumente mit pgvector, senkte die Support-Eskalationen in einem Jahr um 38 % und brachte das Team von wöchentlichen Releases zu mehreren am Tag.";
const verdict = (better: "1" | "2" | "tie") => JSON.stringify({ better, reason: "because" });

describe("checked drafts (plan phase 28)", () => {
  it("explores a search description's leads, ranks them, and offers the others", async () => {
    copilot = replying((sent) =>
      sent.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : sent.includes("the problem it solves")
          ? "Support teams drowning in tickets: Atlas answers from two million documents."
          : "Here is the description: a pgvector system over two million documents.",
    );
    judge = replying((sent) => {
      const [, one = "", two = ""] = sent.split(/Draft [12]:/);
      return verdict(one.includes("drowning") ? "1" : two.includes("drowning") ? "2" : "tie");
    });
    const res = await admin.post("/admin/ai/copilot", {
      task: "seo",
      text: "<p>Atlas: support escalations fell by 38 % with retrieval over two million documents.</p>",
      locale: "en",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      text: "Support teams drowning in tickets: Atlas answers from two million documents.",
      model: "gemini-3.5-flash-lite",
      suggestionId: expect.any(String),
      lead: "problem",
      alternatives: [
        {
          text: "Atlas cut support escalations by 38 % with retrieval over two million documents.",
          lead: "outcome",
        },
        {
          text: "Here is the description: a pgvector system over two million documents.",
          lead: "stack",
          needsReview: ["starts with a preamble instead of the text itself"],
        },
      ],
    });
    expect((await uses())[0]).toMatchObject({
      skill: "seo",
      candidates: 3,
      // The stack lead's two repairs.
      repairs: 2,
      flags: [],
      critic: null,
    });
    // Five drafts and one pair read twice, all the copilot's spend.
    expect(copilot!.calls).toHaveLength(5);
    expect(judge!.calls).toHaveLength(2);
    const spend = await getDb().select().from(aiUsageFeatures);
    expect(spend.map((row) => [row.feature, row.model, row.requests]).sort()).toEqual([
      ["copilot", "gemini-3.5-flash-lite", 5],
      ["copilot", "gemini-3.7-flash", 2],
    ]);
  });

  it("returns a draft that still fails its gates whole, with what it fails, and never a cut", async () => {
    const long = "Eine Übersetzung, die viel zu lang für dieses Feld ist und weitergeht.";
    const { body } = await draft(
      { task: "translate", text: "A translation too long.", from: "en", to: "de", maxLength: 40 },
      long,
    );
    expect(body).toMatchObject({
      text: long,
      needsReview: [`${long.length - 40} characters over the limit of 40`],
    });
    expect((await uses())[0]).toMatchObject({ repairs: 2, flags: ["length"], candidates: 1 });
  });

  it("keeps a translation the critic had revised, and records the critic", async () => {
    copilot = replying((sent) =>
      sent.includes("A reviewer read your translation")
        ? LONG_DE
        : LONG_DE.replace("senkte die Support-Eskalationen", "senkte die Eskalationen"),
    );
    judge = replying(() =>
      JSON.stringify({
        ok: false,
        problems: ["“Support” was dropped from “support escalations”."],
      }),
    );
    const res = await admin.post("/admin/ai/copilot", {
      task: "translate",
      text: LONG,
      from: "en",
      to: "de",
    });
    expect(await res.json()).toMatchObject({
      text: LONG_DE,
      critic: { revised: true, notes: ["“Support” was dropped from “support escalations”."] },
    });
    expect((await uses())[0]).toMatchObject({ critic: "revised", flags: [] });
  });

  it("records which draft the admin kept, and leaves out a pick beyond those offered", async () => {
    copilot = generating(["Atlas: retrieval over two million documents for support teams."]);
    const explored = (await (
      await admin.post("/admin/ai/copilot", {
        task: "seo",
        text: "<p>Atlas: retrieval over two million documents for support.</p>",
        locale: "en",
      })
    ).json()) as { suggestionId: string; alternatives: unknown[] };
    expect(explored.alternatives).toHaveLength(2);
    const single = await draft(
      { task: "translate", text: "Search, briefly.", from: "en", to: "de" },
      "Suche, kurz.",
    );
    const res = await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [
        { id: explored.suggestionId, outcome: "edited", distance: 2, pick: 2 },
        { id: single.body.suggestionId, outcome: "kept", pick: 1 },
      ],
    });
    expect(await res.json()).toEqual({ recorded: 2 });
    const byId = new Map((await uses()).map((u) => [u.id, u]));
    expect(byId.get(explored.suggestionId)).toMatchObject({ outcome: "edited", pick: 2 });
    expect(byId.get(single.body.suggestionId as string)).toMatchObject({
      outcome: "kept",
      pick: null,
    });
    // A pick past the drafts the schema allows is refused outright.
    const refused = await admin.post("/admin/ai/copilot/outcomes", {
      outcomes: [{ id: explored.suggestionId, outcome: "kept", pick: 3 }],
    });
    expect(refused.status).toBe(400);
  });

  it("counts, per version, drafts repaired, flagged, kept from an alternative, revised", async () => {
    const version = skillFor("seo").version;
    await getDb()
      .insert(aiSkillUses)
      .values([
        { skill: "seo", version, words: 20, repairs: 2, flags: ["length"], candidates: 3 },
        { skill: "seo", version, words: 20, repairs: 1, candidates: 3, outcome: "kept", pick: 1 },
        {
          skill: "seo",
          version,
          words: 20,
          candidates: 3,
          outcome: "edited",
          editDistance: 2,
          pick: 0,
        },
        { skill: "seo", version, words: 20, candidates: 3, outcome: "discarded", pick: null },
        {
          skill: "translate",
          version: skillFor("translate").version,
          words: 30,
          critic: "revised",
        },
      ]);
    const view = (await (await admin.get("/admin/ai/skills")).json()) as {
      skills: {
        id: string;
        leads: string[];
        critic: boolean;
        versions: Record<string, unknown>[];
      }[];
    };
    const seo = view.skills.find((s) => s.id === "seo")!;
    expect(seo).toMatchObject({ leads: ["outcome", "problem", "stack"], critic: false });
    expect(seo.versions[0]).toMatchObject({
      uses: 4,
      repaired: 2,
      needsEye: 1,
      alternativesKept: 1,
      revised: 0,
    });
    const translate = view.skills.find((s) => s.id === "translate")!;
    expect(translate.critic).toBe(true);
    expect(translate.versions[0]).toMatchObject({ revised: 1 });
  });
});

describe("the drafts' table (migration 0022)", () => {
  it("holds ids and counts only, and refuses what it does not know", async () => {
    const { rows } = await getDb().execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'ai_skill_uses' order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "candidates",
      "created_at",
      "critic",
      "decided_at",
      "edit_distance",
      "flags",
      "id",
      "model",
      "outcome",
      "pick",
      "repairs",
      "skill",
      "source",
      "version",
      "words",
    ]);
    const base = { skill: "seo", version: "v", words: 3 };
    for (const bad of [
      { ...base, outcome: "loved" as never },
      { ...base, source: "visitor" as never },
      { ...base, outcome: "edited" as const, editDistance: -1 },
      // Migration 0023 (plan phase 28).
      { ...base, repairs: -1 },
      { ...base, candidates: 0 },
      { ...base, candidates: 3, pick: 3 },
      { ...base, critic: "great" as never },
    ]) {
      await expect(getDb().insert(aiSkillUses).values(bad)).rejects.toMatchObject({
        cause: { code: "23514" },
      });
    }
    await getDb().insert(aiSkillUses).values(base);
    const [row] = await getDb().select().from(aiSkillUses).where(eq(aiSkillUses.skill, "seo"));
    expect(row).toMatchObject({
      source: "copilot",
      model: "",
      outcome: null,
      repairs: 0,
      flags: [],
      candidates: 1,
      pick: null,
      critic: null,
    });
  });
});
