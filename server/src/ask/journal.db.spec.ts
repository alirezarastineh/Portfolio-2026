import { beforeEach, describe, expect, it } from "vitest";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app.js";
import { getDb } from "../db/client.js";
import {
  aiCorpusSnapshots,
  aiEvalCases,
  aiJournal,
  aiMessages,
  aiRunItems,
  aiSettings,
  aiUsageFeatures,
} from "../db/schema.js";
import { eventually, FIXTURE_BASE, fixtureConfig } from "../test/ask-fixtures.js";
import { apiError, failing, mockEntry, scripted, textTurn } from "../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../test/helpers.js";
import type { AskConfig } from "./config.js";
import type { CorpusDocument } from "./corpus/build.js";
import { assembleCorpus, type AskCorpus } from "./corpus/index.js";
import { resetRecordedSnapshots } from "./corpus/snapshots.js";
import { applyReplay, getEntry, loadAnswer, loadCorpora, reanalysed } from "./journal-store.js";
import { diagnose, type JournalDiagnosis, type ReplayRecord } from "./journal.js";
import { resetBreakers } from "./models/circuit.js";
import type { ChainRole, ModelEntry } from "./models/registry.js";
import { PROVIDER_DOWN } from "./runs/paid.js";
import { ENTRY_DECIDED } from "./runs/replay-work.js";
import { DEFAULT_SETTINGS, invalidateAssistantCache } from "./settings.js";
import type { AnswerTrace } from "./trace.js";

/**
 * Plan phase 24: the failure journal through the admin API. Diagnose on a
 * seeded visitor answer, the entries and the admin's decisions, and the paid
 * replay as a background run on mock chains.
 */

const LONG: CorpusDocument = {
  id: "project:long@en",
  kind: "project",
  locale: "en",
  title: "Long",
  url: "/en/work/long",
  text: `${"A long case study line about the platform and its teams.\n".repeat(60)}In 2023 he migrated the clusters to Kubernetes with zero downtime.`,
};
const BASE = { ...FIXTURE_BASE, documents: [...FIXTURE_BASE.documents, LONG] };

let config: AskConfig;
let corpus: AskCorpus;
let lite = scripted([textTurn("That is not in the portfolio.")]);
let deep = scripted([
  textTurn("In 2023 he migrated the clusters to Kubernetes [^project:long@en]."),
]);

/** A deploy with no chain configured (no model keys). */
let noChains = false;

const app = createApp({
  ask: {
    config: () => config,
    chain: (_config, role: ChainRole): ModelEntry[] => {
      if (noChains) return [];
      return role === "deep"
        ? [mockEntry("gemini-3.7-flash", deep.model)]
        : [mockEntry("gemini-3.5-flash-lite", lite.model)];
    },
    corpus: async () => corpus,
    evalPacing: null,
  },
});

/** An answer held until the test opens it: a chain in flight. */
function held(text: string): {
  model: MockLanguageModelV4;
  calls: LanguageModelV4CallOptions[];
  open: () => void;
} {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId: "held",
    doStream: async (options) => {
      calls.push(options);
      await opened;
      return {
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          chunks: textTurn(text),
          chunkDelayInMs: null,
        }),
      };
    },
  });
  return { model, calls, open };
}

let admin: TestClient;

beforeEach(async () => {
  await resetDb();
  invalidateAssistantCache();
  resetRecordedSnapshots();
  resetBreakers();
  noChains = false;
  config = fixtureConfig({ firstChunkTimeoutMs: 5_000, requestTimeoutMs: 10_000 });
  corpus = assembleCorpus(BASE, DEFAULT_SETTINGS, [], config);
  lite = scripted([textTurn("That is not in the portfolio.")]);
  deep = scripted([textTurn("In 2023 he migrated the clusters to Kubernetes [^project:long@en].")]);
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

const MODEL = "gemini-3.5-flash-lite";
const QUESTION = "Did he migrate the clusters to Kubernetes?";

const trace = (extra: Partial<AnswerTrace> = {}): AnswerTrace => ({
  v: 1,
  steps: [
    {
      model: MODEL,
      answerOnly: false,
      ttftMs: 700,
      tokens: { input: 1_000, cached: 0, output: 12, thoughts: 0 },
      finishReason: "stop",
      passedOver: [],
      tools: [],
    },
  ],
  core: { locale: "en", layout: "locale", tokens: 900 },
  routing: { reason: "default" },
  ...extra,
});

/** The corpus as the answer read it, kept as its snapshot. */
async function snapshot(key = "snap#1", documents = corpus.documents): Promise<void> {
  await getDb().insert(aiCorpusSnapshots).values({
    key,
    documents,
    projects: corpus.projects,
    posts: corpus.posts,
    coreTokens: 1,
  });
}

/** A visitor's answer that said "it isn't there", logged as the agent logs one. */
async function seedAnswer(
  id = "m_journal0001",
  overrides: Partial<typeof aiMessages.$inferInsert> = {},
): Promise<string> {
  await getDb()
    .insert(aiMessages)
    .values({
      id,
      sessionHash: "session-hash-1",
      locale: "en",
      source: "terminal",
      route: "lite",
      questionRedacted: QUESTION,
      answerExcerpt: "That is not in the portfolio.",
      model: MODEL,
      attempts: [{ model: MODEL, outcome: "ok", ms: 700 }],
      ttftMs: 700,
      totalMs: 1_500,
      tokens: { input: 1_000, cached: 0, output: 12, thoughts: 0 },
      finishReason: "stop",
      promptVersion: "ask-test+abc",
      corpusKey: "snap#1",
      checks: { v: 1, flags: [] },
      trace: trace(),
      ...overrides,
    });
  return id;
}

interface EntryView {
  id: string;
  status: string;
  category: string;
  messageIds: string[];
  diagnosis: JournalDiagnosis;
  rootCause: string;
  fixType: string | null;
  fix: string;
  fixRef: string | null;
  heuristic: string;
  caseId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  replay: { results: { chain: string; answered: boolean }[] } | null;
  message: { id: string; question: string } | null;
}

async function diagnoseAnswer(body: Record<string, unknown>) {
  const res = await admin.post("/admin/assistant/journal/diagnose", body);
  return { status: res.status, body: (await res.json()) as { entry: EntryView; error?: string } };
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await admin.patch(`/admin/assistant/journal/${id}`, body);
  return { status: res.status, body: (await res.json()) as { entry: EntryView; error?: string } };
}

async function list(status?: string) {
  const res = await admin.get(`/admin/assistant/journal${status ? `?status=${status}` : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { entries: EntryView[]; counts: Record<string, number> };
}

const ACCEPTABLE = {
  rootCause: "The fact sat past the cut of the long case study, and the answer never fetched it.",
  heuristic: "Keep what visitors ask about in a document's first part, or hold the document whole.",
};

describe("the failure journal's table (migration 0020)", () => {
  it("holds entries with their checks", async () => {
    const { rows } = await getDb().execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'ai_journal' order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "case_id",
      "category",
      "created_at",
      "decided_at",
      "decided_by",
      "diagnosis",
      "fix",
      "fix_ref",
      "fix_type",
      "heuristic",
      "id",
      "message_ids",
      "replay",
      "root_cause",
      "status",
      "updated_at",
    ]);
    const bad = getDb()
      .insert(aiJournal)
      .values({
        category: "unknown",
        diagnosis: {} as JournalDiagnosis,
        status: "doubtful" as never,
      });
    await expect(bad).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("Diagnose", () => {
  it("diagnoses an unknown answer whose fact sits past a document's cut as clipped context (the done-when)", async () => {
    await snapshot();
    const id = await seedAnswer();

    const { status, body } = await diagnoseAnswer({ messageId: id });
    expect(status).toBe(201);
    const { entry } = body;
    expect(entry).toMatchObject({
      status: "proposed",
      category: "unknown",
      messageIds: [id],
      fixType: "content",
      fixRef: "project:long@en",
      decidedBy: null,
      message: { id, question: QUESTION },
    });
    const { diagnosis } = entry;
    expect(diagnosis.leading).toBe("context-unused");
    expect(diagnosis.located).toMatchObject({
      id: "project:long@en",
      position: "rest",
      pastCut: ["migrated", "clusters", "kubernetes"],
    });
    const h3 = diagnosis.hypotheses[0]!;
    expect(h3).toMatchObject({ id: "context-unused", supporting: 2, contradicting: 0, ratio: 1 });
    expect(h3.evidence.map((e) => e.observation)).toEqual([
      expect.stringMatching(
        /^The core held project:long@en cut at [\d,]+ of [\d,]+ characters; migrated, clusters, kubernetes lie past the cut$/,
      ),
      "It never fetched project:long@en",
    ]);
    expect(entry.rootCause).toBe(diagnosis.proposal.rootCause);
    expect(entry.fix).toMatch(/^Promote project:long@en \(Overview → Perception holds it whole\)/);
    expect(entry.heuristic).toBe(diagnosis.proposal.heuristic);
    expect(diagnosis.context).toMatchObject({
      corpus: "snapshot",
      corpusKey: "snap#1",
      traced: true,
    });

    const listed = await list();
    expect(listed.counts).toEqual({ proposed: 1, accepted: 0, fixed: 0, retired: 0 });
    expect(listed.entries.map((e) => e.id)).toEqual([entry.id]);
  });

  it("analyses a proposed entry again rather than adding one, keeping what the admin wrote", async () => {
    await snapshot();
    const id = await seedAnswer();
    const first = (await diagnoseAnswer({ messageId: id })).body.entry;
    const heuristic = "Mine: when a case study runs long, its last lines must reach the core.";
    expect((await patch(first.id, { heuristic })).status).toBe(200);

    // Named: the admin says where the answer is; the proposal follows, the edit stays.
    const again = await diagnoseAnswer({ messageId: id, expected: "project:atlas" });
    expect(again.status).toBe(200);
    expect(again.body.entry).toMatchObject({ id: first.id, heuristic });
    expect(again.body.entry.diagnosis.located).toMatchObject({
      id: "project:atlas@en",
      named: true,
    });
    expect(again.body.entry.rootCause).toBe(again.body.entry.diagnosis.proposal.rootCause);
    // Without `expected`, the named document is kept; null forgets it.
    const kept = await diagnoseAnswer({ messageId: id });
    expect(kept.body.entry.diagnosis.located).toMatchObject({
      id: "project:atlas@en",
      named: true,
    });
    const forgot = await diagnoseAnswer({ messageId: id, expected: null });
    expect(forgot.body.entry.diagnosis.located).toMatchObject({
      id: "project:long@en",
      named: false,
    });
    expect((await list()).entries).toHaveLength(1);
  });

  it("refuses unknown answers, playground answers, unknown documents and decided entries", async () => {
    await snapshot();
    const id = await seedAnswer();
    await seedAnswer("m_playground01", { source: "playground" });
    expect((await diagnoseAnswer({ messageId: "m_nothing0001" })).status).toBe(404);
    expect((await diagnoseAnswer({ messageId: "m_playground01" })).status).toBe(404);
    expect((await diagnoseAnswer({ messageId: "bad id" })).status).toBe(400);
    const unknown = await diagnoseAnswer({ messageId: id, expected: "project:nowhere" });
    expect(unknown).toMatchObject({ status: 400, body: { error: "unknown_document" } });

    const { entry } = (await diagnoseAnswer({ messageId: id })).body;
    expect((await patch(entry.id, { status: "accepted", ...ACCEPTABLE })).status).toBe(200);
    const decided = await diagnoseAnswer({ messageId: id });
    expect(decided).toMatchObject({
      status: 409,
      body: { error: "already_journaled", detail: { id: entry.id } },
    });
  });

  it("reads today's corpus for an answer whose own was not kept, and says so", async () => {
    const id = await seedAnswer("m_nosnapshot1", { corpusKey: null });
    const { body } = await diagnoseAnswer({ messageId: id });
    expect(body.entry.diagnosis.context.corpus).toBe("live");
    expect(body.entry.diagnosis.untested).toContain(
      "The answer's corpus was not kept: the experiments read today's corpus.",
    );
    expect(body.entry.diagnosis.leading).toBe("context-unused");
  });

  it("finds a rephrase in the session, and names it among the symptoms", async () => {
    await snapshot();
    const id = await seedAnswer();
    await seedAnswer("m_journal0002", {
      questionRedacted: "Did he migrate any clusters to Kubernetes?",
      createdAt:
        sql`(select created_at + interval '30 seconds' from ai_messages where id = ${id})` as never,
    });
    const { body } = await diagnoseAnswer({ messageId: id });
    expect(body.entry.diagnosis.symptoms).toEqual(["unknown", "rephrased"]);
  });
});

describe("the admin's decisions", () => {
  async function proposed(): Promise<EntryView> {
    await snapshot();
    return (await diagnoseAnswer({ messageId: await seedAnswer() })).body.entry;
  }

  it("accepts with a root cause and a heuristic that says something, then fixes with a case", async () => {
    const entry = await proposed();
    expect(await patch(entry.id, { status: "fixed" })).toMatchObject({
      status: 409,
      body: { error: "bad_transition" },
    });
    expect(await patch(entry.id, { status: "accepted", heuristic: "Be careful." })).toMatchObject({
      status: 400,
      body: { error: "vague_heuristic" },
    });
    expect(await patch(entry.id, { status: "accepted", rootCause: " " })).toMatchObject({
      status: 400,
      body: { error: "missing_root_cause" },
    });
    const accepted = await patch(entry.id, { status: "accepted", ...ACCEPTABLE });
    expect(accepted.body.entry).toMatchObject({ status: "accepted", decidedBy: "admin" });
    expect(accepted.body.entry.decidedAt).not.toBeNull();

    // Fixed needs the fix: what it is, or the case that tests it.
    const noFix = await patch(entry.id, { status: "fixed", fixRef: null, caseId: null });
    expect(noFix).toMatchObject({ status: 400, body: { error: "missing_fix" } });
    expect(await patch(entry.id, { caseId: "00000000-0000-4000-8000-000000000000" })).toMatchObject(
      { status: 400, body: { error: "unknown_case" } },
    );

    const [frozen] = await getDb()
      .insert(aiEvalCases)
      .values({ question: "Did he migrate clusters?", locale: "en", snapshotKey: "snap#1" })
      .returning({ id: aiEvalCases.id });
    const fixed = await patch(entry.id, { status: "fixed", fixRef: null, caseId: frozen!.id });
    expect(fixed.body.entry).toMatchObject({ status: "fixed", caseId: frozen!.id, fixRef: null });

    // The case deleted, the entry keeps its history without it.
    await getDb().delete(aiEvalCases).where(eq(aiEvalCases.id, frozen!.id));
    const [row] = await getDb().select().from(aiJournal).where(eq(aiJournal.id, entry.id));
    expect(row).toMatchObject({ status: "fixed", caseId: null });
  });

  it("retires an entry, reopens it, and deletes it for good", async () => {
    const entry = await proposed();
    const retired = await patch(entry.id, { status: "retired" });
    expect(retired.body.entry).toMatchObject({ status: "retired", decidedBy: "admin" });
    const reopened = await patch(entry.id, { status: "proposed" });
    expect(reopened.body.entry).toMatchObject({
      status: "proposed",
      decidedBy: null,
      decidedAt: null,
    });
    expect((await list("retired")).entries).toHaveLength(0);

    expect((await admin.delete(`/admin/assistant/journal/${entry.id}`)).status).toBe(200);
    expect((await admin.delete(`/admin/assistant/journal/${entry.id}`)).status).toBe(404);
    expect((await patch(entry.id, { status: "accepted" })).status).toBe(404);
  });

  it("keeps an entry once its answer is pruned, and keeps the journal for the admin only", async () => {
    const entry = await proposed();
    await getDb().delete(aiMessages).where(eq(aiMessages.id, entry.messageIds[0]!));
    const [kept] = (await list()).entries;
    expect(kept).toMatchObject({ id: entry.id, message: null });
    expect(kept!.diagnosis.leading).toBe("context-unused");

    const stranger = new TestClient(app, "198.51.100.9");
    expect((await stranger.get("/admin/assistant/journal")).status).toBe(401);
    const post = await stranger.post("/admin/assistant/journal/diagnose", {
      messageId: "m_journal0001",
    });
    expect([401, 403]).toContain(post.status);
  });
});

describe("the replay (paid, a background run)", () => {
  async function entryId(): Promise<string> {
    await snapshot();
    return (await diagnoseAnswer({ messageId: await seedAnswer() })).body.entry.id;
  }

  const startReplay = (entry: string) =>
    admin.post("/admin/assistant/runs", { kind: "agent", entry });

  const runView = (id: string) =>
    eventually(async () => {
      const res = await admin.get(`/admin/assistant/runs/${id}`);
      const view = (await res.json()) as {
        run: { status: string; error: string | null };
        items: { key: string; status: string; result: Record<string, unknown> | null }[];
      };
      return ["done", "failed", "cancelled"].includes(view.run.status) ? view : undefined;
    }, 10_000);

  it("waits for the admin to switch admin agents on", async () => {
    const entry = await entryId();
    const refused = await startReplay(entry);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "feature_off" });
  });

  it("answers again on both chains, records the spend as agent, and merges the evidence", async () => {
    const entry = await entryId();
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, featureSwitches: { agent: true } });
    invalidateAssistantCache();

    const started = await startReplay(entry);
    expect(started.status).toBe(202);
    const { id } = (await started.json()) as { id: string };
    const view = await runView(id);
    expect(view.run).toMatchObject({ status: "done", error: null });
    expect(view.items.map((i) => [i.key, i.status])).toEqual([
      ["lite", "done"],
      ["deep", "done"],
    ]);
    expect(view.items.map((i) => i.result)).toEqual([
      expect.objectContaining({ chain: "lite", model: MODEL, answered: false, unknown: true }),
      expect.objectContaining({
        chain: "deep",
        model: "gemini-3.7-flash",
        answered: true,
        cited: ["project:long@en"],
      }),
    ]);
    // Outcomes only: the run keeps neither chain's text.
    const items = JSON.stringify(await getDb().select().from(aiRunItems));
    expect(items).not.toContain("migrated the clusters");
    expect(items).not.toContain("not in the portfolio");

    const spent = await getDb().select().from(aiUsageFeatures);
    expect(new Set(spent.map((r) => r.feature))).toEqual(new Set(["agent"]));

    const [merged] = (await list()).entries;
    expect(merged!.replay?.results.map((r) => [r.chain, r.answered])).toEqual([
      ["lite", false],
      ["deep", true],
    ]);
    expect(merged!.diagnosis.replayed).toBe(true);
    const routed = merged!.diagnosis.hypotheses.find((h) => h.id === "under-routed")!;
    expect(routed.evidence.filter((e) => e.supports).map((e) => e.observation)).toEqual([
      `Replayed today, the deep chain answers it (gemini-3.7-flash); the lite chain does not (${MODEL})`,
    ]);
  });

  it("refuses an unknown entry, a retired one, and one whose answer is gone", async () => {
    const entry = await entryId();
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, featureSwitches: { agent: true } });
    invalidateAssistantCache();

    const unknown = await startReplay("00000000-0000-4000-8000-000000000000");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "unknown_entry" });

    await patch(entry, { status: "retired" });
    const retired = await startReplay(entry);
    expect(retired.status).toBe(409);
    expect(await retired.json()).toEqual({ error: "not_replayable" });

    // Fixed is the admin's record too.
    await patch(entry, { status: "proposed" });
    await patch(entry, { status: "accepted", ...ACCEPTABLE });
    await patch(entry, { status: "fixed", fixRef: "project:long@en" });
    const fixed = await startReplay(entry);
    expect(fixed.status).toBe(409);
    expect(await fixed.json()).toEqual({ error: "not_replayable" });

    await patch(entry, { status: "retired" });
    await patch(entry, { status: "proposed" });
    await getDb().delete(aiMessages);
    const gone = await startReplay(entry);
    expect(gone.status).toBe(409);
    expect(await gone.json()).toEqual({ error: "answer_gone" });
  });

  it("refuses a replay with no chain to answer on", async () => {
    const entry = await entryId();
    await switchOn();
    noChains = true;
    const refused = await startReplay(entry);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "no_chain" });
  });

  it("writes nothing while a chain has no model answering, and a resume finishes it", async () => {
    const entry = await entryId();
    await switchOn();
    deep = failing(apiError(500), "gemini-3.7-flash");

    const first = await started(entry);
    const down = await runView(first);
    expect(down.run).toMatchObject({ status: "failed", error: PROVIDER_DOWN });
    expect(down.items.map((i) => [i.key, i.status])).toEqual([
      ["lite", "done"],
      ["deep", "unavailable"],
    ]);
    // An outage is no evidence: the entry waits for every chain.
    expect((await list()).entries[0]!.replay).toBeNull();

    deep = scripted([
      textTurn("In 2023 he migrated the clusters to Kubernetes [^project:long@en]."),
    ]);
    resetBreakers();
    expect((await admin.post(`/admin/assistant/runs/${first}/resume`, {})).status).toBe(202);
    const done = await runView(first);
    expect(done.run).toMatchObject({ status: "done", error: null });
    // The lite chain answered once: a resume asks only the chain left.
    expect(lite.calls).toHaveLength(1);
    expect((await list()).entries[0]!.replay?.results.map((r) => [r.chain, r.answered])).toEqual([
      ["lite", false],
      ["deep", true],
    ]);
  });

  it("stops between chains at its cap, writing nothing", async () => {
    const entry = await entryId();
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, featureSwitches: { agent: true }, featureCaps: { agent: 0.0000001 } });
    invalidateAssistantCache();

    const view = await runView(await started(entry));
    expect(view.run.status).toBe("failed");
    expect(view.run.error).toMatch(/its own daily cap/);
    expect(view.items.map((i) => [i.key, i.status])).toEqual([
      ["lite", "done"],
      ["deep", "pending"],
    ]);
    expect(deep.calls).toHaveLength(0);
    expect((await list()).entries[0]!.replay).toBeNull();
  });

  it("stops before the next chain once the entry is retired, and leaves it as decided", async () => {
    const entry = await entryId();
    await switchOn();
    const gate = held("That is not in the portfolio.");
    lite = gate;

    const id = await started(entry);
    // The lite chain is answering when the admin retires the entry.
    await eventually(async () => (gate.calls.length === 1 ? true : undefined));
    expect((await patch(entry, { status: "retired" })).status).toBe(200);
    gate.open();
    const view = await runView(id);
    expect(view.run).toMatchObject({ status: "failed", error: ENTRY_DECIDED });
    // The lite chain finished; the deep chain was never asked.
    expect(view.items.map((i) => [i.key, i.status])).toEqual([
      ["lite", "done"],
      ["deep", "pending"],
    ]);
    expect(deep.calls).toHaveLength(0);
    const [row] = await getDb().select().from(aiJournal).where(eq(aiJournal.id, entry));
    expect(row).toMatchObject({ status: "retired", replay: null });
  });

  async function switchOn(): Promise<void> {
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, featureSwitches: { agent: true } });
    invalidateAssistantCache();
  }

  async function started(entry: string): Promise<string> {
    const res = await startReplay(entry);
    expect(res.status).toBe(202);
    return ((await res.json()) as { id: string }).id;
  }
});

describe("a new analysis joining its entry", () => {
  const record: ReplayRecord = {
    runId: "00000000-0000-4000-8000-0000000000aa",
    at: "2026-10-07T10:00:00.000Z",
    corpusKey: "live#1",
    results: [],
  };

  it("says why a replay could not join: the entry decided, its answer pruned, the entry gone", async () => {
    await snapshot();
    const { entry } = (await diagnoseAnswer({ messageId: await seedAnswer() })).body;
    await patch(entry.id, { status: "retired" });
    expect(await applyReplay(entry.id, record)).toBe("entry_decided");
    await patch(entry.id, { status: "proposed" });
    await getDb().delete(aiMessages);
    expect(await applyReplay(entry.id, record)).toBe("answer_gone");
    await getDb().delete(aiJournal);
    expect(await applyReplay(entry.id, record)).toBe("entry_gone");
  });

  it("reads the entry again when its status moved while the replay was being analysed", async () => {
    await snapshot();
    const { entry } = (await diagnoseAnswer({ messageId: await seedAnswer() })).body;
    let writes = 0;
    // The admin accepts the entry between the first read and the first write.
    const write: typeof reanalysed = async (row, diagnosis, replay) => {
      if (writes++ === 0) await patch(entry.id, { status: "accepted", ...ACCEPTABLE });
      return reanalysed(row, diagnosis, replay);
    };
    const applied = await applyReplay(entry.id, record, write);
    expect(writes).toBe(2);
    // Accepted: the replay joins, the admin's fields stay theirs.
    expect(applied).toMatchObject({ status: "accepted", ...ACCEPTABLE, replay: record });
  });

  it("keeps an edit the admin saved while the entry was being analysed", async () => {
    await snapshot();
    const id = await seedAnswer();
    const first = (await diagnoseAnswer({ messageId: id })).body.entry;
    // Read before the admin saves, as an analysis or a replay's end reads it.
    const stale = (await getEntry(first.id))!;
    const heuristic =
      "Mine, saved meanwhile: keep what visitors ask about early in a long case study.";
    expect((await patch(first.id, { heuristic })).status).toBe(200);

    const answer = (await loadAnswer(id))!;
    const fresh = diagnose({ answer, ...(await loadCorpora(answer)), expected: "project:atlas" });
    expect(fresh.proposal.rootCause).not.toBe(stale.rootCause);
    const updated = await reanalysed(stale, fresh);
    expect(updated).toMatchObject({ heuristic, rootCause: fresh.proposal.rootCause });
  });
});
