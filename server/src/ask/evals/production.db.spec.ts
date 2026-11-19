import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createApp } from "../../app.js";
import { getDb } from "../../db/client.js";
import { aiCorpusSnapshots, aiEvalCases, aiMessages, aiUsage } from "../../db/schema.js";
import { FIXTURE_BASE, fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { mockEntry, scripted, textTurn } from "../../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import type { AskConfig } from "../config.js";
import type { CorpusDocument } from "../corpus/build.js";
import { assembleCorpus } from "../corpus/index.js";
import {
  askCorpusFromSnapshot,
  pruneSnapshots,
  recordSnapshot,
  resetRecordedSnapshots,
  snapshotKey,
} from "../corpus/snapshots.js";
import { resetBreakers } from "../models/circuit.js";
import { DEFAULT_SETTINGS, invalidateAssistantCache } from "../settings.js";
import { productionCases, runProductionSuite } from "./production.js";
import { runEvals } from "./run.js";

let config: AskConfig;
const app = createApp({
  ask: { config: () => config, corpus: (c) => Promise.resolve(fixtureCorpus(c)), evalPacing: null },
});
let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetBreakers();
  resetRecordedSnapshots();
  config = fixtureConfig();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const VESPER: CorpusDocument = {
  id: "project:vesper@en",
  kind: "project",
  locale: "en",
  title: "Vesper",
  url: "/en/work/vesper",
  text: "Vesper cut cloud costs by 42%.",
};

/**
 * The corpus as it was when a visitor asked: a project since unpublished
 * (Vesper), Atlas's text as it read then, and the profile as it still is.
 */
function oldCorpus() {
  const live = fixtureCorpus(config);
  return askCorpusFromSnapshot({
    key: "en:1|a:old",
    documents: [
      ...live.documents.map((d) =>
        d.id === "project:atlas@en" ? { ...d, text: "Atlas, as it read in the spring." } : d,
      ),
      VESPER,
    ],
    projects: live.projects,
    posts: live.posts,
    coreTokens: 0,
  });
}

async function answered(
  id: string,
  corpusKey: string,
  citedIds: string[],
  source = "terminal",
): Promise<void> {
  await getDb()
    .insert(aiMessages)
    .values({
      id,
      source,
      corpusKey,
      citedIds,
      sessionHash: "s",
      locale: "en",
      route: "lite",
      totalMs: 1,
      tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "p",
      questionRedacted: `What does ${citedIds[0] ?? "it"} say?`,
      answerExcerpt: "…",
    });
}

/** A question asked `minutes` ago, as the log keeps it. */
async function askedBefore(
  id: string,
  question: string,
  minutes: number,
  session = "s",
  source = "terminal",
): Promise<void> {
  await getDb()
    .insert(aiMessages)
    .values({
      id,
      source,
      sessionHash: session,
      locale: "en",
      route: "lite",
      totalMs: 1,
      tokens: { input: 1, cached: 0, output: 1, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "p",
      questionRedacted: question,
      answerExcerpt: "…",
      createdAt: new Date(Date.now() - minutes * 60_000),
    });
}

const freeze = (body: Record<string, unknown>) =>
  admin.post("/admin/assistant/eval-cases", { personalChecked: true, ...body });

describe("corpus snapshots", () => {
  it("tell two builds of one corpus key apart, by a digest of the documents", () => {
    const corpus = oldCorpus();
    const same = askCorpusFromSnapshot({ ...corpus, coreTokens: 0 });
    // A deploy that builds a document differently, under the same content versions.
    const rebuilt = askCorpusFromSnapshot({
      ...corpus,
      coreTokens: 0,
      documents: corpus.documents.map((d) =>
        d.id === "profile@en" ? { ...d, text: `${d.text} (built anew)` } : d,
      ),
    });
    expect(snapshotKey(same)).toBe(snapshotKey(corpus));
    expect(snapshotKey(rebuilt)).not.toBe(snapshotKey(corpus));
    expect(snapshotKey(rebuilt).startsWith(`${corpus.key}#`)).toBe(true);
  });

  it("keep the admin's tiers on the documents, so a replay renders each language's core again", async () => {
    const tiered = assembleCorpus(
      FIXTURE_BASE,
      { ...DEFAULT_SETTINGS, corpusTiers: { promoted: ["project:atlas@en"], demoted: [] } },
      [],
      config,
    );
    await recordSnapshot(tiered);
    const [row] = await getDb().select().from(aiCorpusSnapshots);
    expect(row.documents.find((d) => d.id === "project:atlas@en")?.tier).toBe("promoted");
    expect(row.coreTokens).toBe(Math.max(tiered.coreTokens.en, tiered.coreTokens.de));

    const replayed = askCorpusFromSnapshot(row);
    expect(replayed.core).toEqual(tiered.core);
    expect(replayed.compact).toEqual(tiered.compact);
    expect(row.key).toBe(snapshotKey(tiered));
  });

  it("are written once per key, and pruned once nothing refers to them", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    resetRecordedSnapshots();
    await recordSnapshot(corpus);
    expect(await getDb().select().from(aiCorpusSnapshots)).toHaveLength(1);

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const bare = { documents: [], projects: [], posts: [], coreTokens: 0 };
    await getDb()
      .insert(aiCorpusSnapshots)
      .values([
        { ...bare, key: "unused-old", createdAt: twoDaysAgo },
        { ...bare, key: "unused-new" },
        { ...bare, key: "answered-old", createdAt: twoDaysAgo },
      ]);
    await answered("m_answered_old", "answered-old", []);
    await getDb()
      .update(aiCorpusSnapshots)
      .set({ createdAt: twoDaysAgo })
      .where(sql`${aiCorpusSnapshots.key} = ${snapshotKey(corpus)}`);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    const vesperFreeze = await freeze({ messageId: "m_vesper" });
    expect(vesperFreeze.status).toBe(201);
    // Its answer pruned, the snapshot lives on for its eval case.
    await getDb()
      .delete(aiMessages)
      .where(sql`${aiMessages.id} = 'm_vesper'`);

    await pruneSnapshots();
    const snapshots = await getDb().select().from(aiCorpusSnapshots);
    const kept = snapshots.map((s) => s.key).sort(byCodePoint);
    expect(kept).toEqual(["answered-old", snapshotKey(corpus), "unused-new"].sort(byCodePoint));
  });
});

const byCodePoint = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};

const vesperAnswer = () =>
  scripted([textTurn("Vesper cut cloud costs by 42% [^project:vesper@en].")]);

const tableRowCounts = () =>
  Promise.all(
    [aiMessages, aiUsage, aiCorpusSnapshots, aiEvalCases].map(async (table) => {
      const found = await getDb().select().from(table);
      return found.length;
    }),
  );

async function replayProduction() {
  const model = scripted([
    textTurn("Vesper is a cost project [^project:vesper@en]."),
    textTurn("It used Go [^project:vesper@en]."),
    textTurn("Vesper cut cloud costs by 42% [^project:vesper@en]."),
  ]);
  const suite = await runProductionSuite({
    config,
    concurrency: 1,
    judge: false,
    promptVersion: "test",
    chain: () => [mockEntry("gemini-3.5-flash-lite", model.model)],
  });
  return { suite, prompts: model.calls.map((call) => call.prompt) };
}

describe("production eval cases", () => {
  it("freeze a visitor's answer with what it cited, and refuse one that cannot be replayed", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    const res = await freeze({ messageId: "m_vesper", mustInclude: ["42"] });
    expect(res.status).toBe(201);
    const [row] = await getDb().select().from(aiEvalCases);
    expect(row).toMatchObject({
      suite: "production",
      question: "What does project:vesper@en say?",
      // A lone question, as every case frozen before turns was.
      turns: null,
      snapshotKey: snapshotKey(corpus),
      mustCite: ["project:vesper@en"],
      mustInclude: ["42"],
      fromMessageId: "m_vesper",
      status: "active",
    });

    // Answered before snapshots were kept; a playground answer; an unknown one; a bad pattern.
    await answered("m_before", "en:0|a:gone", []);
    const beforeRes = await freeze({ messageId: "m_before" });
    expect(await beforeRes.json()).toEqual({
      error: "no_snapshot",
    });
    await answered("m_playground", snapshotKey(corpus), [], "playground");
    const playgroundRes = await freeze({ messageId: "m_playground" });
    expect(playgroundRes.status).toBe(404);
    const unknownRes = await freeze({ messageId: "m_unknown_1" });
    expect(unknownRes.status).toBe(404);
    const badPatternRes = await freeze({ messageId: "m_vesper", mustInclude: ["(unclosed"] });
    expect(badPatternRes.status).toBe(400);
  });

  it("re-run against their own snapshot, not today's corpus", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    await freeze({ messageId: "m_vesper", mustInclude: ["42"] });

    const options = {
      config,
      concurrency: 1,
      judge: false,
      promptVersion: "test",
    };
    const before = await tableRowCounts();
    const first = await runProductionSuite({
      ...options,
      chain: () => [mockEntry("gemini-3.5-flash-lite", vesperAnswer().model)],
    });
    const again = await runProductionSuite({
      ...options,
      chain: () => [mockEntry("gemini-3.5-flash-lite", vesperAnswer().model)],
    });
    for (const run of [first, again]) {
      expect(run).toMatchObject({ planned: 1, missing: 0 });
      expect(run.results).toEqual([
        expect.objectContaining({ passed: true, cited: ["project:vesper@en"], failures: [] }),
      ]);
    }
    // The suite only reads: no answer, usage, snapshot or case row appeared.
    expect(await tableRowCounts()).toEqual(before);

    // Today's corpus no longer has Vesper: the same answer's citation would be invented.
    const [frozen] = await productionCases();
    const today = await runEvals({
      ...options,
      cases: [frozen.evalCase],
      corpus: fixtureCorpus(config),
      chain: () => [mockEntry("gemini-3.5-flash-lite", vesperAnswer().model)],
    });
    expect(today.results[0].failures).toContain("did not cite project:vesper@en");
  });

  it("take the session's earlier questions as the admin rewrote them, and replay them the same twice", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await askedBefore("m_earlier_1", "Which projects has he built?", 5);
    await askedBefore("m_earlier_2", "I'm Jane from Acme: tell me about Vesper.", 4);
    await askedBefore("m_earlier_3", "Which stack did it use?", 3);
    await askedBefore("m_earlier_4", "And how long did it take?", 2);
    await askedBefore("m_other_tab", "A question in another session.", 3, "t");
    await askedBefore("m_playground_1", "An admin's question.", 3, "s", "playground");
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);

    // The three before it in its session, oldest first: not another session's, nor the admin's.
    const earlier = async (id: string) => admin.get(`/admin/assistant/eval-cases/earlier/${id}`);
    const vesperEarlier = await earlier("m_vesper");
    expect(await vesperEarlier.json()).toEqual({
      questions: [
        "I'm Jane from Acme: tell me about Vesper.",
        "Which stack did it use?",
        "And how long did it take?",
      ],
    });
    const firstEarlier = await earlier("m_earlier_1");
    expect(await firstEarlier.json()).toEqual({ questions: [] });
    const playgroundEarlier = await earlier("m_playground_1");
    expect(playgroundEarlier.status).toBe(404);
    const unknownEarlier = await earlier("m_unknown_1");
    expect(unknownEarlier.status).toBe(404);
    const badEarlier = await earlier("bad");
    expect(badEarlier.status).toBe(400);

    // At most three, each a question the terminal would take.
    const four = ["One question?", "Two questions?", "Three questions?", "Four questions?"];
    const fourRes = await freeze({ messageId: "m_vesper", turns: four });
    expect(fourRes.status).toBe(400);
    const shortRes = await freeze({ messageId: "m_vesper", turns: ["x"] });
    expect(shortRes.status).toBe(400);
    expect(await getDb().select().from(aiEvalCases)).toHaveLength(0);

    // The visitor's name and company left out; the third question dropped.
    const turns = ["Tell me about Vesper.", "Which stack did it use?"];
    const res = await freeze({ messageId: "m_vesper", turns, mustInclude: ["42"] });
    expect(res.status).toBe(201);
    const [row] = await getDb().select().from(aiEvalCases);
    expect(row.turns).toEqual([
      { question: "Tell me about Vesper." },
      { question: "Which stack did it use?" },
    ]);
    const listRes = await admin.get("/admin/assistant/eval-cases");
    const listed = (await listRes.json()) as {
      cases: { turns: string[] }[];
    };
    expect(listed.cases[0].turns).toEqual(turns);

    // Each earlier question answered first, then the case's, as a visitor's would be.
    const first = await replayProduction();
    const again = await replayProduction();
    expect(first.suite.results).toEqual([
      expect.objectContaining({ passed: true, failures: [], cited: ["project:vesper@en"] }),
    ]);
    expect(first.suite.results[0].conversation).toEqual({
      turns: [
        {
          question: "Tell me about Vesper.",
          answer: "Vesper is a cost project [^project:vesper@en].",
          live: true,
        },
        {
          question: "Which stack did it use?",
          answer: "It used Go [^project:vesper@en].",
          live: true,
        },
      ],
      droppedAnswers: 0,
      windowDropped: 0,
    });
    // The case's question reached the model after both turns, signed answers included.
    expect(first.prompts).toHaveLength(3);
    const last = JSON.stringify(first.prompts[2]);
    for (const text of [
      "Tell me about Vesper.",
      "It used Go",
      "What does project:vesper@en say?",
    ]) {
      expect(last).toContain(text);
    }
    expect(again.prompts).toEqual(first.prompts);
    expect(again.suite.results[0].conversation).toEqual(first.suite.results[0].conversation);
  });

  it("list with their staleness against the live corpus, and retire", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    await answered("m_atlas_1", snapshotKey(corpus), ["project:atlas@en"]);
    await answered("m_profile", snapshotKey(corpus), ["profile@en"]);
    await ["m_vesper", "m_atlas_1", "m_profile"].reduce(
      (prev, messageId) => prev.then(() => freeze({ messageId })),
      Promise.resolve<unknown>(undefined),
    );

    const list = async () => {
      const res = await admin.get("/admin/assistant/eval-cases");
      const body = (await res.json()) as {
        cases: { id: string; mustCite: string[]; stale: string | null; status: string }[];
      };
      return body.cases;
    };
    const initialList = await list();
    const stale = Object.fromEntries(initialList.map((c) => [c.mustCite[0], c.stale]));
    expect(stale).toEqual({
      "project:vesper@en": "gone",
      "project:atlas@en": "changed",
      "profile@en": null,
    });

    const latestList = await list();
    const vesper = latestList.find((c) => c.mustCite[0] === "project:vesper@en");
    expect(vesper).toBeDefined();
    if (!vesper) {
      throw new Error("missing vesper case");
    }
    const retire = await admin.patch(`/admin/assistant/eval-cases/${vesper.id}`, {
      status: "retired",
    });
    expect(retire.status).toBe(200);
    const afterRetire = await list();
    expect(afterRetire.find((c) => c.id === vesper.id)?.status).toBe("retired");
    const activeCases = await productionCases();
    expect(activeCases.map((c) => c.evalCase.mustCite)).not.toContainEqual(["project:vesper@en"]);
  });

  it("keep the question as the admin rewrote it, and are deleted for good", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    // The visitor named their company: the case keeps the rewritten question only.
    const res = await freeze({ messageId: "m_vesper", question: "What did Vesper achieve?" });
    const { id } = (await res.json()) as { id: string };
    const [row] = await getDb().select().from(aiEvalCases);
    expect(row).toMatchObject({ id, question: "What did Vesper achieve?" });

    const delRes = await admin.delete(`/admin/assistant/eval-cases/${id}`);
    expect(delRes.status).toBe(200);
    expect(await getDb().select().from(aiEvalCases)).toHaveLength(0);
    const missingDelRes = await admin.delete(`/admin/assistant/eval-cases/${id}`);
    expect(missingDelRes.status).toBe(404);
    const shortQuestionRes = await freeze({ messageId: "m_vesper", question: "x" });
    expect(shortQuestionRes.status).toBe(400);
    // Never without the admin’s word that nothing personal is left.
    const uncheckedRes = await freeze({ messageId: "m_vesper", personalChecked: false });
    expect(uncheckedRes.status).toBe(400);
    const noCheckRes = await admin.post("/admin/assistant/eval-cases", { messageId: "m_vesper" });
    expect(noCheckRes.status).toBe(400);
    expect(await getDb().select().from(aiEvalCases)).toHaveLength(0);
  });

  it("is admin-only", async () => {
    const anonymous = new TestClient(app);
    const res = await anonymous.get("/admin/assistant/eval-cases");
    expect(res.status).toBe(401);
  });
});
