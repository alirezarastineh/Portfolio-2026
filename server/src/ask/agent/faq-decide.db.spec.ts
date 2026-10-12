import { MockLanguageModelV4 } from "ai/test";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { getDb } from "../../db/client.js";
import {
  aiAudit,
  aiFaq,
  aiFaqProposals,
  aiInsightSnapshots,
  aiJournal,
  aiLessons,
  aiMessages,
  aiSettings,
  aiSkillUses,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { mockEntry, usage } from "../../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import type { AskConfig } from "../config.js";
import type { JournalDiagnosis } from "../journal.js";
import { resetBreakers } from "../models/circuit.js";
import { invalidateAssistantCache } from "../settings.js";
import { recordUse } from "../skills/uses.js";
import type { FaqProposal } from "./faq-chain.js";

let config: AskConfig;

/** The chain as a good model answers it (faq-chain.db.spec.ts covers the drafting itself). */
const writer = new MockLanguageModelV4({
  modelId: "writer",
  doGenerate: async (call) => {
    const sent = JSON.stringify(call.prompt);
    const text = sent.includes("Write one question for the FAQ")
      ? "Is he open to relocating?"
      : sent.includes("Draft an answer in English")
        ? "Yes, within the EU [^profile@en]."
        : sent.includes("Is he open to relocating?")
          ? "Ist er offen für einen Umzug?"
          : "Ja, innerhalb der EU.";
    return {
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: usage(50, 10),
      warnings: [],
    };
  },
});

const app = createApp({
  ask: {
    config: () => config,
    chain: (_c, role) => (role === "copilot" ? [mockEntry("gemini-3.5-flash-lite", writer)] : []),
    corpus: async (c) => fixtureCorpus(c),
  },
});

let admin: TestClient;
let seq = 0;

const TOPIC = {
  title: "Relocation and remote work",
  summary: "Visitors ask whether he would move for a role.",
  questions: 6,
  examples: ["would he move to berlin?"],
  unanswered: true,
};

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig();
  seq = 0;
  await seed();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

afterEach(() => vi.restoreAllMocks());

async function snapshot(topics: unknown[] = [TOPIC]): Promise<string> {
  const [row] = await getDb()
    .insert(aiInsightSnapshots)
    .values({ trigger: "admin", analysed: 30, topics: topics as never })
    .returning({ id: aiInsightSnapshots.id });
  return row!.id;
}

/** Visitor answers about relocating, each this many minutes ago: "it isn't there" when failed. */
async function answers(rows: { minutesAgo: number; failed: boolean; question: string }[]) {
  await getDb()
    .insert(aiMessages)
    .values(
      rows.map((a) => {
        seq++;
        return {
          id: `m_faqtest${String(seq).padStart(5, "0")}`,
          sessionHash: `session-${seq}`,
          locale: "en" as const,
          route: "lite",
          questionRedacted: a.question,
          answerExcerpt: a.failed
            ? "That is not in the portfolio."
            : "Yes, within the EU [^faq:x@en].",
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

const DRAFTS = {
  questionEn: "Is he open to relocating?",
  questionDe: "Ist er offen für einen Umzug?",
  answerEn: "Yes, within the EU.",
  answerDe: "Ja, innerhalb der EU.",
};

/** A proposal as the chain leaves it, each draft with its skill use. */
async function proposal(
  change: Partial<typeof aiFaqProposals.$inferInsert> = {},
): Promise<FaqProposal> {
  const use = (skill: "faq-question" | "faq-answer" | "translate", text: string) =>
    recordUse({ skill, version: "v", model: "m", text, abstained: false, source: "agent" });
  const uses = {
    questionEn: await use("faq-question", DRAFTS.questionEn),
    questionDe: await use("translate", DRAFTS.questionDe),
    answerEn: await use("faq-answer", DRAFTS.answerEn),
    answerDe: await use("translate", DRAFTS.answerDe),
  };
  let source: Partial<typeof aiFaqProposals.$inferInsert> = {};
  if (change.source !== "journal") {
    const snapshotId = change.snapshotId ?? (await snapshot());
    source = {
      source: "insight",
      snapshotId,
      topicIndex: 0,
      topic: { snapshotId, title: TOPIC.title, questions: 6, unanswered: true },
    };
  }
  const [row] = await getDb()
    .insert(aiFaqProposals)
    .values({ source: "insight", ...source, ...DRAFTS, uses, status: "proposed", ...change })
    .returning();
  return row!;
}

async function journalEntry(change: Partial<typeof aiJournal.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(aiJournal)
    .values({ messageIds: [], category: "unknown", diagnosis: {} as JournalDiagnosis, ...change })
    .returning();
  return row!;
}

/** The text the admin accepts: the drafts as they are, unless changed. */
const finalText = (translations?: Record<string, unknown>) => ({
  isVisible: true,
  translations: translations ?? {
    en: { question: DRAFTS.questionEn, answer: DRAFTS.answerEn },
    de: { question: DRAFTS.questionDe, answer: DRAFTS.answerDe },
  },
});

const accept = (id: string, body: Record<string, unknown>) =>
  admin.post(`/admin/assistant/faq-proposals/${id}/accept`, body);
const reject = (id: string) => admin.post(`/admin/assistant/faq-proposals/${id}/reject`, {});
const row = async (id: string) =>
  (await getDb().select().from(aiFaqProposals).where(eq(aiFaqProposals.id, id)))[0]!;
const lessonRow = async (id: string) =>
  (await getDb().select().from(aiLessons).where(eq(aiLessons.id, id)))[0]!;

const STATEMENT =
  "When visitors ask whether he would relocate, the FAQ entry answers it from the portfolio.";

type Accepted = {
  proposal: FaqProposal;
  linked: { journal: boolean; lesson: string | null };
};
type Listed = {
  proposals: (FaqProposal & {
    lessons: { id: string; statement: string }[];
    newLesson: string | null;
  })[];
  limited: boolean;
};
type LessonView = {
  id: string;
  appliedAs: string | null;
  appliedRef: string | null;
  effect: {
    before: { answers: number; unknown: number };
    after: { answers: number; unknown: number };
    applications: number;
  } | null;
};

describe("deciding the FAQ proposals (plan phase 31)", () => {
  it("turns an unanswered topic into an accepted FAQ entry with provenance, and tracks its unknown rate (the done-when)", async () => {
    await getDb()
      .insert(aiSettings)
      .values({ id: 1, featureSwitches: { agent: true } });
    invalidateAssistantCache();
    // Visitors asked, and the assistant could not answer.
    await answers([
      { minutesAgo: 600, failed: true, question: "Would he relocate to Berlin?" },
      { minutesAgo: 500, failed: true, question: "Is relocation possible for him?" },
    ]);
    const snapshotId = await snapshot();

    // The chain drafts it; the list offers a new lesson (the topic is corroborated).
    const drafted = await admin.post("/admin/assistant/faq-proposals", {
      source: "insight",
      snapshotId,
      topic: 0,
    });
    expect(drafted.status).toBe(201);
    const { proposal: p } = (await drafted.json()) as { proposal: FaqProposal };
    const listed = (await (
      await admin.get("/admin/assistant/faq-proposals?status=proposed,needs_you")
    ).json()) as Listed;
    expect(listed.proposals).toEqual([
      expect.objectContaining({ id: p.id, lessons: [], newLesson: null }),
    ]);

    // The admin accepts it, measured by a new lesson in their words.
    const res = await accept(p.id, {
      ...finalText({
        en: { question: p.questionEn, answer: p.answerEn },
        de: { question: p.questionDe, answer: p.answerDe },
      }),
      lesson: { statement: STATEMENT, scope: ["relocate", "relocation"] },
    });
    expect(res.status).toBe(200);
    const { proposal, linked } = (await res.json()) as Accepted;
    expect(proposal).toMatchObject({ status: "accepted", faqId: expect.any(String) });
    expect(linked).toEqual({ journal: false, lesson: proposal.lessonId });

    // Live: the assistant's FAQ has it, in both languages.
    const faq = (await (await admin.get("/admin/assistant/faq")).json()) as {
      faq: { id: string; translations: Record<string, { question: string; answer: string }> }[];
    };
    expect(faq.faq).toEqual([
      expect.objectContaining({
        id: proposal.faqId,
        translations: {
          en: expect.objectContaining({ question: p.questionEn, answer: p.answerEn }),
          de: expect.objectContaining({ question: p.questionDe, answer: p.answerDe }),
        },
      }),
    ]);

    // Provenance: the entry's source on the proposal, the entry on the lesson.
    expect(await row(p.id)).toMatchObject({
      source: "insight",
      snapshotId,
      topic: { snapshotId, title: TOPIC.title, questions: 6, unanswered: true },
      faqId: proposal.faqId,
      // Decided, it keeps no text: the entry has the admin's words.
      questionEn: "",
      questionDe: "",
      answerEn: "",
      answerDe: "",
      notes: [],
    });
    expect(await lessonRow(proposal.lessonId!)).toMatchObject({
      source: "insight",
      statement: STATEMENT,
      scope: ["relocate", "relocation"],
      topic: { snapshotId, title: TOPIC.title, questions: 6, unanswered: true },
      appliedAs: "faq",
      appliedRef: proposal.faqId,
      status: "active",
    });
    expect(await getDb().select().from(aiAudit).where(eq(aiAudit.action, "faq.accept"))).toEqual([
      expect.objectContaining({ target: p.id, decision: "allowed" }),
    ]);

    // Tracked: visitors' answers since the fix count against those before it.
    await answers([
      { minutesAgo: 0, failed: false, question: "Would he relocate for a role?" },
      { minutesAgo: 0, failed: true, question: "Can he relocate next month?" },
    ]);
    const lessons = (await (await admin.get("/admin/assistant/lessons")).json()) as {
      lessons: LessonView[];
    };
    const measured = lessons.lessons.find((l) => l.id === proposal.lessonId)!;
    expect(measured).toMatchObject({ appliedAs: "faq", appliedRef: proposal.faqId });
    expect(measured.effect).toMatchObject({
      before: { answers: 2, unknown: 2 },
      after: { answers: 2, unknown: 1 },
      applications: 2,
    });
  });

  it("measures it by a lesson already made from the same topic, or from the journal entry", async () => {
    const snapshotId = await snapshot();
    const made = await admin.post("/admin/assistant/lessons", {
      source: "insight",
      statement: STATEMENT,
      scope: ["relocate"],
      snapshotId,
      topic: 0,
    });
    const { lesson } = (await made.json()) as { lesson: { id: string } };
    // A later run's topic of the same name is the same topic.
    const p = await proposal({ snapshotId: await snapshot() });
    const listed = (await (await admin.get("/admin/assistant/faq-proposals")).json()) as Listed;
    expect(listed.proposals[0]).toMatchObject({
      id: p.id,
      lessons: [{ id: lesson.id, statement: STATEMENT }],
      newLesson: null,
    });

    const res = await accept(p.id, { ...finalText(), lesson: { id: lesson.id } });
    expect(res.status).toBe(200);
    const accepted = (await res.json()) as Accepted;
    expect(accepted.linked.lesson).toBe(lesson.id);
    expect(await lessonRow(lesson.id)).toMatchObject({
      appliedAs: "faq",
      appliedRef: accepted.proposal.faqId,
      status: "active",
    });
    // Applied now: no longer offered.
    const again = await proposal({ snapshotId: await snapshot(), topicIndex: 0 });
    const relisted = (await (
      await admin.get("/admin/assistant/faq-proposals?status=proposed")
    ).json()) as Listed;
    expect(relisted.proposals.find((x) => x.id === again.id)?.lessons).toEqual([]);
  });

  it("links a journal entry's fix to the entry, unless the entry names another fix", async () => {
    const open = await journalEntry({ fixType: "faq" });
    const elsewhere = await journalEntry({ fixType: "content", fix: "Add it to the About page." });
    const first = await proposal({ source: "journal", journalId: open.id });
    const second = await proposal({ source: "journal", journalId: elsewhere.id });

    // A journal lesson needs three entries: the list says so.
    const listed = (await (await admin.get("/admin/assistant/faq-proposals")).json()) as Listed;
    expect(listed.proposals.find((x) => x.id === first.id)?.newLesson).toMatch(
      /a lesson from the journal needs 3 accepted or fixed entries/,
    );

    const a = (await (await accept(first.id, finalText())).json()) as Accepted;
    expect(a.linked).toEqual({ journal: true, lesson: null });
    const [entry] = await getDb().select().from(aiJournal).where(eq(aiJournal.id, open.id));
    // The fix is the entry; the status stays the admin's.
    expect(entry).toMatchObject({ fixType: "faq", fixRef: a.proposal.faqId, status: "proposed" });

    const b = (await (await accept(second.id, finalText())).json()) as Accepted;
    expect(b.linked).toEqual({ journal: false, lesson: null });
    const [kept] = await getDb().select().from(aiJournal).where(eq(aiJournal.id, elsewhere.id));
    expect(kept).toMatchObject({ fixType: "content", fixRef: null });
  });

  it("refuses what it cannot keep, and writes nothing then", async () => {
    const thin = await snapshot([{ ...TOPIC, questions: 3 }]);
    const p = await proposal();
    const few = await proposal({
      snapshotId: thin,
      topic: { snapshotId: thin, title: TOPIC.title, questions: 3, unanswered: true },
    });
    const entry = await journalEntry();
    const fromJournal = await proposal({ source: "journal", journalId: entry.id });
    const other = await getDb()
      .insert(aiLessons)
      .values([
        {
          statement: STATEMENT,
          scope: ["move"],
          source: "insight",
          topic: { snapshotId: thin, title: "Rates", questions: 9, unanswered: true },
        },
        {
          statement: STATEMENT,
          scope: ["move"],
          source: "insight",
          topic: { snapshotId: thin, title: TOPIC.title, questions: 9, unanswered: true },
          appliedAs: "faq",
          appliedRef: "x",
          appliedAt: new Date(),
          status: "active",
        },
        {
          statement: STATEMENT,
          scope: ["move"],
          source: "insight",
          topic: { snapshotId: thin, title: TOPIC.title, questions: 9, unanswered: true },
          status: "retired",
        },
      ])
      .returning({ id: aiLessons.id });
    const [rates, applied, retired] = other.map((l) => l.id);

    const refused = async (
      id: string,
      body: Record<string, unknown>,
      status: number,
      error: Record<string, unknown>,
    ) => {
      const res = await accept(id, body);
      expect(res.status, JSON.stringify(error)).toBe(status);
      expect(await res.json(), JSON.stringify(error)).toEqual(error);
    };
    const newLesson = (statement: string, scope: string[]) => ({
      ...finalText(),
      lesson: { statement, scope },
    });
    await refused(p.id, finalText({ en: { question: "Hi", answer: DRAFTS.answerEn } }), 400, {
      error: "invalid_input",
    });
    await refused(p.id, finalText({}), 400, { error: "invalid_input" });
    await refused(few.id, newLesson(STATEMENT, ["move"]), 400, {
      error: "not_corroborated",
      detail: { reason: "the topic has 3 questions; 5 needed" },
    });
    await refused(fromJournal.id, newLesson(STATEMENT, ["move"]), 400, {
      error: "not_corroborated",
      detail: {
        reason:
          "a lesson from the journal needs 3 accepted or fixed entries: make it in the Journal, then link it here",
      },
    });
    await refused(p.id, newLesson("Answer it.", ["move"]), 400, { error: "vague_statement" });
    await refused(p.id, newLesson(STATEMENT, ["a", "!!"]), 400, { error: "empty_scope" });
    const missing = "00000000-0000-4000-8000-000000000999";
    await refused(p.id, { ...finalText(), lesson: { id: missing } }, 400, {
      error: "unknown_lesson",
    });
    await refused(p.id, { ...finalText(), lesson: { id: rates } }, 400, {
      error: "lesson_elsewhere",
    });
    await refused(p.id, { ...finalText(), lesson: { id: applied } }, 409, {
      error: "lesson_applied",
    });
    await refused(p.id, { ...finalText(), lesson: { id: retired } }, 409, {
      error: "lesson_retired",
    });
    await refused(missing, finalText(), 404, { error: "not_found" });
    await refused("not-a-uuid", finalText(), 404, { error: "not_found" });

    // Nothing written: no entry, no lesson applied, the proposals still open.
    expect(await getDb().select().from(aiFaq)).toEqual([]);
    expect((await row(p.id)).status).toBe("proposed");
    expect((await lessonRow(rates!)).appliedAt).toBeNull();

    // Decided once: neither accepted nor rejected again.
    expect((await accept(p.id, finalText())).status).toBe(200);
    for (const res of [await accept(p.id, finalText()), await reject(p.id)]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_open" });
    }
    expect(await getDb().select().from(aiFaq)).toHaveLength(1);
  });

  it("rejects without writing the FAQ, its drafts discarded", async () => {
    const p = await proposal({ notes: ["Answer (DE): A second reading found: a typo."] });
    const res = await reject(p.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Accepted).proposal).toMatchObject({
      status: "rejected",
      questionEn: "",
      answerEn: "",
      notes: [],
    });
    expect(await getDb().select().from(aiFaq)).toEqual([]);
    const uses = await getDb().select().from(aiSkillUses);
    expect(uses.map((u) => u.outcome)).toEqual([
      "discarded",
      "discarded",
      "discarded",
      "discarded",
    ]);
    expect(await getDb().select().from(aiAudit).where(eq(aiAudit.action, "faq.reject"))).toEqual([
      expect.objectContaining({ target: p.id, decision: "allowed" }),
    ]);
    expect((await reject("00000000-0000-4000-8000-000000000999")).status).toBe(404);
  });

  it("decides each draft by what the admin kept: as it was, edited, or left out", async () => {
    const p = await proposal();
    const res = await accept(
      p.id,
      finalText({ en: { question: DRAFTS.questionEn, answer: "Yes, within the European Union." } }),
    );
    expect(res.status).toBe(200);
    const outcome = async (field: keyof typeof DRAFTS) =>
      (await getDb().select().from(aiSkillUses).where(eq(aiSkillUses.id, p.uses[field]!)))[0]!;
    expect(await outcome("questionEn")).toMatchObject({ outcome: "kept", editDistance: 0 });
    expect(await outcome("answerEn")).toMatchObject({ outcome: "edited", editDistance: 3 });
    // German left out of the entry: its drafts were not kept.
    expect(await outcome("questionDe")).toMatchObject({ outcome: "discarded" });
    expect(await outcome("answerDe")).toMatchObject({ outcome: "discarded" });
  });

  it("lists the proposals by status, newest first", async () => {
    const first = await proposal();
    const second = await proposal();
    await reject(first.id);
    const ids = async (query: string) =>
      (
        (await (await admin.get(`/admin/assistant/faq-proposals${query}`)).json()) as Listed
      ).proposals.map((p) => p.id);
    expect(await ids("")).toEqual([second.id, first.id]);
    expect(await ids("?status=rejected")).toEqual([first.id]);
    expect(await ids("?status=proposed,needs_you")).toEqual([second.id]);
    // A decided one offers no lesson.
    const all = (await (await admin.get("/admin/assistant/faq-proposals")).json()) as Listed;
    expect(all.proposals.find((p) => p.id === first.id)).toMatchObject({
      lessons: [],
      newLesson: null,
    });
    expect(all.limited).toBe(false);
    for (const query of ["?status=bogus", "?status=", "?status=accepted,bogus"]) {
      expect((await admin.get(`/admin/assistant/faq-proposals${query}`)).status).toBe(400);
    }
  });
});
