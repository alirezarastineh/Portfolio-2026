import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import { getDb } from "../../db/client.js";
import {
  aiFaq,
  aiFaqProposals,
  aiInsightSnapshots,
  aiJournal,
  aiMessages,
  aiSettings,
  aiSkillUses,
  aiUsageFeatures,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { apiError, mockEntry, usage } from "../../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import type { AskConfig } from "../config.js";
import type { JournalDiagnosis } from "../journal.js";
import { resetBreakers } from "../models/circuit.js";
import { invalidateAssistantCache } from "../settings.js";
import { CONTENT_GAP, type FaqProposal } from "./faq-chain.js";

let config: AskConfig;
let writer: ReturnType<typeof writing>;

const app = createApp({
  ask: {
    config: () => config,
    chain: (_c, role) =>
      role === "copilot" ? [mockEntry("gemini-3.5-flash-lite", writer.model)] : [],
    corpus: async (c) => fixtureCorpus(c),
  },
});

let admin: TestClient;

/** What each step's instructions open with. */
const STEP = {
  question: "Write one question for the FAQ",
  answer: "Draft an answer in English",
  translate: "Translate the text from English to German",
};

/**
 * A writer that answers each step from what it is sent; `fails` makes a step's
 * calls fail (the provider down), `hold` keeps every call waiting until opened.
 */
function writing(
  reply: (sent: string) => string,
  options: { fails?: (sent: string) => boolean; hold?: Promise<void> } = {},
) {
  const calls: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    modelId: "writer",
    doGenerate: async (call) => {
      calls.push(call);
      if (options.hold) await options.hold;
      const sent = JSON.stringify(call.prompt);
      if (options.fails?.(sent)) throw apiError(503);
      const text = reply(sent);
      return {
        content: text ? [{ type: "text", text }] : [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(50, 10),
        warnings: [],
      };
    },
  });
  return { model, calls, sent: () => calls.map((c) => JSON.stringify(c.prompt)) };
}

/** The chain as a good model answers it; `answer` replaces the English answer. */
const chain =
  (answer = "Yes, within the EU [^profile@en].") =>
  (sent: string): string => {
    if (sent.includes(STEP.question)) return "Is he open to relocating?";
    if (sent.includes(STEP.answer)) return answer;
    if (sent.includes(STEP.translate)) {
      return sent.includes("Is he open to relocating?")
        ? "Ist er offen für einen Umzug?"
        : "Ja, innerhalb der EU.";
    }
    return "";
  };

const TOPIC = {
  title: "Relocation and remote work",
  summary: "Visitors ask whether he would move for a role.",
  questions: 6,
  examples: ["would he move to berlin?", "Is remote work an option for him?"],
  unanswered: true,
};

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig();
  writer = writing(chain());
  // The content, for the glossary the translations keep.
  await seed();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

afterEach(() => vi.restoreAllMocks());

async function switchOn() {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, featureSwitches: { agent: true } })
    .onConflictDoUpdate({ target: aiSettings.id, set: { featureSwitches: { agent: true } } });
  invalidateAssistantCache();
}

async function snapshot(topics: unknown[] = [TOPIC]): Promise<string> {
  const [row] = await getDb()
    .insert(aiInsightSnapshots)
    .values({ trigger: "admin", analysed: 30, topics: topics as never })
    .returning({ id: aiInsightSnapshots.id });
  return row!.id;
}

/** A journal entry on a visitor's answer, the answer kept or (no question) pruned. */
async function journalEntry(
  question: string | null,
  messageId = "m_relocate0001",
): Promise<string> {
  if (question !== null) {
    await getDb()
      .insert(aiMessages)
      .values({
        id: messageId,
        sessionHash: "session-1",
        locale: "de",
        route: "lite",
        questionRedacted: question,
        answerExcerpt: "Das steht nicht im Portfolio.",
        totalMs: 900,
        tokens: { input: 100, cached: 0, output: 20, thoughts: 0 },
        finishReason: "stop",
        promptVersion: "ask-test",
        checks: { v: 1, flags: [] },
      });
  }
  const [row] = await getDb()
    .insert(aiJournal)
    .values({
      messageIds: [messageId],
      category: "unknown",
      diagnosis: {} as JournalDiagnosis,
    })
    .returning({ id: aiJournal.id });
  return row!.id;
}

type Drafted = { proposal: FaqProposal; existing?: boolean };
const draft = (body: Record<string, unknown>) => admin.post("/admin/assistant/faq-proposals", body);

describe("the FAQ pipeline drafts proposals (plan phase 31)", () => {
  it("drafts from an insight topic: the question, its German, a grounded answer and its German", async () => {
    await switchOn();
    const snapshotId = await snapshot();
    const res = await draft({ source: "insight", snapshotId, topic: 0 });
    expect(res.status).toBe(201);
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal).toMatchObject({
      source: "insight",
      snapshotId,
      topicIndex: 0,
      topic: { snapshotId, title: TOPIC.title, questions: 6, unanswered: true },
      journalId: null,
      questionEn: "Is he open to relocating?",
      questionDe: "Ist er offen für einen Umzug?",
      // The answer without its citation markers, as the FAQ shows it.
      answerEn: "Yes, within the EU.",
      answerDe: "Ja, innerhalb der EU.",
      flags: [],
      notes: [],
      status: "proposed",
      faqId: null,
    });
    // Nothing reached the FAQ.
    expect(await getDb().select().from(aiFaq)).toEqual([]);

    // Four steps, in order; the visitors' questions went fenced, never as instructions.
    const sent = writer.sent();
    expect(sent).toHaveLength(4);
    expect(sent[0]).toContain(STEP.question);
    expect(sent[0]).toContain(
      String.raw`<visitor locale=\"en\">would he move to berlin?</visitor>`,
    );
    expect(sent[0]).toContain("Topic: Relocation and remote work");
    expect(sent[1]).toContain(STEP.translate);
    expect(sent[2]).toContain(STEP.answer);
    expect(sent[3]).toContain(STEP.translate);
    // The portfolio's names went with each translation (the glossary).
    expect(sent[1]).toContain("Keep these names and terms exactly as they are");

    // No visitor text kept: the topic's name and counts only.
    const [row] = await getDb().select().from(aiFaqProposals);
    expect(JSON.stringify(row)).not.toContain("would he move to berlin");
    expect(JSON.stringify(row)).not.toContain(TOPIC.summary);

    // Each draft recorded as the agent's, waiting for the admin's decision; spent as `agent`.
    const uses = await getDb().select().from(aiSkillUses);
    expect(uses.map((u) => [u.skill, u.source, u.outcome]).sort()).toEqual([
      ["faq-answer", "agent", null],
      ["faq-question", "agent", null],
      ["translate", "agent", null],
      ["translate", "agent", null],
    ]);
    expect(Object.keys(proposal.uses).sort()).toEqual([
      "answerDe",
      "answerEn",
      "questionDe",
      "questionEn",
    ]);
    const spent = await getDb().select().from(aiUsageFeatures);
    expect(spent.map((r) => [r.feature, r.requests])).toEqual([["agent", 4]]);
  });

  it("marks a content gap when the portfolio has no answer, and invents none", async () => {
    await switchOn();
    writer = writing(chain("NO_ANSWER"));
    const res = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    expect(res.status).toBe(201);
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal).toMatchObject({
      questionEn: "Is he open to relocating?",
      questionDe: "Ist er offen für einen Umzug?",
      answerEn: "",
      answerDe: "",
      notes: [CONTENT_GAP],
      status: "needs_you",
    });
    // No answer to translate: three calls.
    expect(writer.calls).toHaveLength(3);
    // The abstention is decided at once, and not the proposal's to decide.
    expect(proposal.uses.answerEn).toBeUndefined();
    const [answer] = await getDb()
      .select()
      .from(aiSkillUses)
      .where(eq(aiSkillUses.skill, "faq-answer"));
    expect(answer).toMatchObject({ outcome: "abstained" });
  });

  it("drafts from a journal entry's question, and not once its answer is pruned", async () => {
    await switchOn();
    const entryId = await journalEntry("Würde er für eine Stelle umziehen?");
    const res = await draft({ source: "journal", entryId });
    expect(res.status).toBe(201);
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal).toMatchObject({
      source: "journal",
      journalId: entryId,
      snapshotId: null,
      topic: null,
      status: "proposed",
    });
    // The visitor's question, fenced, in its own language.
    expect(writer.sent()[0]).toContain(
      String.raw`<visitor locale=\"de\">Würde er für eine Stelle umziehen?</visitor>`,
    );
    expect(JSON.stringify(proposal)).not.toContain("umziehen");

    const pruned = await journalEntry(null, "m_pruned000001");
    const gone = await draft({ source: "journal", entryId: pruned });
    expect(gone.status).toBe(409);
    expect(await gone.json()).toEqual({ error: "question_gone" });
    expect(writer.calls).toHaveLength(4);
  });

  it("refuses a source that is not there, and input it does not take", async () => {
    await switchOn();
    const snapshotId = await snapshot();
    const missing = "00000000-0000-4000-8000-000000000999";
    for (const [body, error] of [
      [{ source: "insight", snapshotId, topic: 3 }, "unknown_topic"],
      [{ source: "insight", snapshotId: missing, topic: 0 }, "unknown_topic"],
      [{ source: "journal", entryId: missing }, "unknown_entry"],
    ] as const) {
      const res = await draft(body);
      expect(res.status, error).toBe(404);
      expect(await res.json()).toEqual({ error });
    }
    for (const body of [
      { source: "insight", snapshotId, topic: -1 },
      { source: "insight", snapshotId: "not-a-uuid", topic: 0 },
      { source: "journal" },
      { source: "insight", snapshotId, topic: 0, extra: true },
    ]) {
      expect((await draft(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(writer.calls).toHaveLength(0);
  });

  it("returns a source's open proposal without a model call, and runs one chain for two clicks", async () => {
    await switchOn();
    let open: () => void = () => {};
    const hold = new Promise<void>((resolve) => (open = resolve));
    writer = writing(chain(), { hold });
    const snapshotId = await snapshot();
    const body = { source: "insight", snapshotId, topic: 0 };
    const first = draft(body);
    await eventually(async () => (writer.calls.length === 1 ? true : undefined));
    // The second click lands while the first chain waits on its model.
    const second = draft(body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    open();
    const [a, b] = await Promise.all([first, second]);
    const ids = [
      ((await a.json()) as Drafted).proposal.id,
      ((await b.json()) as Drafted).proposal.id,
    ];
    expect(ids[0]).toBe(ids[1]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(writer.calls).toHaveLength(4);

    const again = await draft(body);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ proposal: { id: ids[0] }, existing: true });
    expect(writer.calls).toHaveLength(4);
    expect(await getDb().select().from(aiFaqProposals)).toHaveLength(1);
  });

  it("is an admin agent: refused while switched off, and nothing spent", async () => {
    const res = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feature_off" });
    expect(writer.calls).toHaveLength(0);
    expect(await getDb().select().from(aiFaqProposals)).toEqual([]);
  });

  it("keeps what was drafted when a later step's models fail, for the admin to finish", async () => {
    await switchOn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    writer = writing(chain(), { fails: (sent) => sent.includes(STEP.answer) });
    const res = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    expect(res.status).toBe(201);
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal).toMatchObject({
      questionEn: "Is he open to relocating?",
      questionDe: "Ist er offen für einen Umzug?",
      answerEn: "",
      answerDe: "",
      status: "needs_you",
    });
    expect(proposal.notes).toEqual([expect.stringMatching(/^Answer \(EN\): not drafted/)]);
    // Spent all the same.
    expect((await getDb().select().from(aiUsageFeatures))[0]).toMatchObject({ feature: "agent" });

    // No question, nothing to propose.
    resetBreakers();
    writer = writing(chain(), { fails: (sent) => sent.includes(STEP.question) });
    const down = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "unavailable" });
    expect(await getDb().select().from(aiFaqProposals)).toHaveLength(1);
  });

  it("flags a question that still fails its checks after the repairs, for the admin's eye", async () => {
    await switchOn();
    writer = writing((sent) =>
      sent.includes(STEP.question) ? "Is he open to relocating" : chain()(sent),
    );
    const res = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal.status).toBe("needs_you");
    expect(proposal.flags).toEqual(["questionEn:question"]);
    expect(proposal.notes).toContain("Question (EN): does not end with a question mark");
    const [use] = await getDb()
      .select()
      .from(aiSkillUses)
      .where(eq(aiSkillUses.skill, "faq-question"));
    expect(use).toMatchObject({ repairs: 2, flags: ["question"] });
  });

  it("does not answer a question the answer skill cannot take, and says so", async () => {
    await switchOn();
    writer = writing((sent) => (sent.includes(STEP.question) ? "A?" : chain()(sent)));
    const res = await draft({ source: "insight", snapshotId: await snapshot(), topic: 0 });
    expect(res.status).toBe(201);
    const { proposal } = (await res.json()) as Drafted;
    expect(proposal).toMatchObject({ questionEn: "A?", answerEn: "", status: "needs_you" });
    expect(proposal.notes).toEqual([
      "Answer (EN): not drafted, the question is not one to answer (3 to 300 characters). Rewrite it, then draft the answer in the FAQ form.",
    ]);
    // The question and its German only.
    expect(writer.calls).toHaveLength(2);
  });
});
