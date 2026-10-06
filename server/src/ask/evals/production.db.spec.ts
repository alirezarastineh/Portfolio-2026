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
  ask: { config: () => config, corpus: async (c) => fixtureCorpus(c), evalPacing: null },
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
    expect(row!.documents.find((d) => d.id === "project:atlas@en")?.tier).toBe("promoted");
    expect(row!.coreTokens).toBe(Math.max(tiered.coreTokens.en, tiered.coreTokens.de));

    const replayed = askCorpusFromSnapshot(row!);
    expect(replayed.core).toEqual(tiered.core);
    expect(replayed.compact).toEqual(tiered.compact);
    expect(row!.key).toBe(snapshotKey(tiered));
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
    expect((await freeze({ messageId: "m_vesper" })).status).toBe(201);
    // Its answer pruned, the snapshot lives on for its eval case.
    await getDb()
      .delete(aiMessages)
      .where(sql`${aiMessages.id} = 'm_vesper'`);

    await pruneSnapshots();
    const kept = (await getDb().select().from(aiCorpusSnapshots)).map((s) => s.key).sort();
    expect(kept).toEqual(["answered-old", snapshotKey(corpus), "unused-new"].sort());
  });
});

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
      snapshotKey: snapshotKey(corpus),
      mustCite: ["project:vesper@en"],
      mustInclude: ["42"],
      fromMessageId: "m_vesper",
      status: "active",
    });

    // Answered before snapshots were kept; a playground answer; an unknown one; a bad pattern.
    await answered("m_before", "en:0|a:gone", []);
    expect(await (await freeze({ messageId: "m_before" })).json()).toEqual({
      error: "no_snapshot",
    });
    await answered("m_playground", snapshotKey(corpus), [], "playground");
    expect((await freeze({ messageId: "m_playground" })).status).toBe(404);
    expect((await freeze({ messageId: "m_unknown_1" })).status).toBe(404);
    expect((await freeze({ messageId: "m_vesper", mustInclude: ["(unclosed"] })).status).toBe(400);
  });

  it("re-run against their own snapshot, not today's corpus", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    await freeze({ messageId: "m_vesper", mustInclude: ["42"] });

    const answer = () =>
      scripted([textTurn("Vesper cut cloud costs by 42% [^project:vesper@en].")]);
    const options = {
      config,
      concurrency: 1,
      judge: false,
      promptVersion: "test",
    };
    const rows = async () =>
      Promise.all(
        [aiMessages, aiUsage, aiCorpusSnapshots, aiEvalCases].map(
          async (table) => (await getDb().select().from(table)).length,
        ),
      );
    const before = await rows();
    const first = await runProductionSuite({
      ...options,
      chain: () => [mockEntry("gemini-3.5-flash-lite", answer().model)],
    });
    const again = await runProductionSuite({
      ...options,
      chain: () => [mockEntry("gemini-3.5-flash-lite", answer().model)],
    });
    for (const run of [first, again]) {
      expect(run).toMatchObject({ planned: 1, missing: 0 });
      expect(run.results).toEqual([
        expect.objectContaining({ passed: true, cited: ["project:vesper@en"], failures: [] }),
      ]);
    }
    // The suite only reads: no answer, usage, snapshot or case row appeared.
    expect(await rows()).toEqual(before);

    // Today's corpus no longer has Vesper: the same answer's citation would be invented.
    const [frozen] = await productionCases();
    const today = await runEvals({
      ...options,
      cases: [frozen!.evalCase],
      corpus: fixtureCorpus(config),
      chain: () => [mockEntry("gemini-3.5-flash-lite", answer().model)],
    });
    expect(today.results[0]!.failures).toContain("did not cite project:vesper@en");
  });

  it("list with their staleness against the live corpus, and retire", async () => {
    const corpus = oldCorpus();
    await recordSnapshot(corpus);
    await answered("m_vesper", snapshotKey(corpus), ["project:vesper@en"]);
    await answered("m_atlas_1", snapshotKey(corpus), ["project:atlas@en"]);
    await answered("m_profile", snapshotKey(corpus), ["profile@en"]);
    for (const messageId of ["m_vesper", "m_atlas_1", "m_profile"]) await freeze({ messageId });

    const list = async () =>
      (
        (await (await admin.get("/admin/assistant/eval-cases")).json()) as {
          cases: { id: string; mustCite: string[]; stale: string | null; status: string }[];
        }
      ).cases;
    const stale = Object.fromEntries((await list()).map((c) => [c.mustCite[0], c.stale]));
    expect(stale).toEqual({
      "project:vesper@en": "gone",
      "project:atlas@en": "changed",
      "profile@en": null,
    });

    const vesper = (await list()).find((c) => c.mustCite[0] === "project:vesper@en")!;
    const retire = await admin.patch(`/admin/assistant/eval-cases/${vesper.id}`, {
      status: "retired",
    });
    expect(retire.status).toBe(200);
    expect((await list()).find((c) => c.id === vesper.id)?.status).toBe("retired");
    expect((await productionCases()).map((c) => c.evalCase.mustCite)).not.toContainEqual([
      "project:vesper@en",
    ]);
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

    expect((await admin.delete(`/admin/assistant/eval-cases/${id}`)).status).toBe(200);
    expect(await getDb().select().from(aiEvalCases)).toHaveLength(0);
    expect((await admin.delete(`/admin/assistant/eval-cases/${id}`)).status).toBe(404);
    expect((await freeze({ messageId: "m_vesper", question: "x" })).status).toBe(400);
    // Never without the admin’s word that nothing personal is left.
    expect((await freeze({ messageId: "m_vesper", personalChecked: false })).status).toBe(400);
    expect(
      (await admin.post("/admin/assistant/eval-cases", { messageId: "m_vesper" })).status,
    ).toBe(400);
    expect(await getDb().select().from(aiEvalCases)).toHaveLength(0);
  });

  it("is admin-only", async () => {
    const anonymous = new TestClient(app);
    expect((await anonymous.get("/admin/assistant/eval-cases")).status).toBe(401);
  });
});
