import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import {
  aiFaqProposals,
  aiInsightSnapshots,
  aiJournal,
  aiMessages,
  type FaqDraftField,
  type FaqProposalStatus,
} from "../../db/schema.js";
import { altImage } from "../alt-image.js";
import { askConfig, askCorpus } from "../deps.js";
import { availability, refusal } from "../guard.js";
import { skillModels, type SkillSession } from "../one-shot.js";
import { readAiSettings } from "../settings.js";
import { skillFor } from "../skills/registry.js";
import { runSkill, type SkillRun } from "../skills/run.js";
import { SkillAnswer, type Failure, type SkillContext } from "../skills/skill.js";
import { recordUse } from "../skills/uses.js";
import { recordUsage, summarizeCalls } from "../usage.js";
import { contentGlossary } from "./glossary.js";
import { criticNotes } from "./verdicts.js";

/**
 * The FAQ pipeline (plan phase 31, the book's Prompt Chaining with gates and
 * an Approval Gate): from an insight topic or a journal entry, a chain of
 * versioned skills, each gated and repaired (Phase 28), drafts an FAQ entry
 * into a proposal (`ai_faq_proposals`), never into the FAQ:
 *   1. the question in English (`faq-question`, from the visitors' questions,
 *      fenced), then in German (`translate`);
 *   2. a grounded answer in English (`faq-answer`); `NO_ANSWER` is a content
 *      gap the admin fills, never an invented answer;
 *   3. the answer in German (`translate`, with the glossary, and its critic).
 * The admin accepts it (faq-decide.ts: then it is live) or rejects it. One
 * request, fenced once as `agent` (the admin agents' switch and cap); every
 * call recorded under it. One chain per source at a time, one open proposal
 * per source. The proposal keeps the source's ids and a topic's name and
 * counts, never the visitors' questions.
 */

export type FaqProposal = typeof aiFaqProposals.$inferSelect;
type NewFaqProposal = typeof aiFaqProposals.$inferInsert;

export type FaqSourceInput =
  { source: "insight"; snapshotId: string; topic: number } | { source: "journal"; entryId: string };

/** What the chain starts from: the visitors' questions (read, never kept) and what the proposal keeps. */
interface FaqSource {
  /** One chain at a time per source. */
  key: string;
  kept: Pick<NewFaqProposal, "source" | "snapshotId" | "topicIndex" | "topic" | "journalId">;
  title?: string;
  summary?: string;
  questions: string[];
}

/** As the question skill takes a visitor's question (`faqQuestionInput`). */
const QUESTION_CHARS = 300;
const TITLE_CHARS = 200;
const SUMMARY_CHARS = 500;
/** The FAQ's own limits (`faqInput`): a draft past them is flagged, never cut. */
const FAQ_QUESTION_MAX = 300;
const FAQ_ANSWER_MAX = 3000;

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/** The source, read again; why not when it is gone. */
export async function faqSource(
  input: FaqSourceInput,
): Promise<FaqSource | { error: "unknown_topic" | "unknown_entry" | "question_gone" }> {
  const db = getDb();
  if (input.source === "insight") {
    const [snapshot] = await db
      .select({ id: aiInsightSnapshots.id, topics: aiInsightSnapshots.topics })
      .from(aiInsightSnapshots)
      .where(eq(aiInsightSnapshots.id, input.snapshotId));
    const topic = snapshot?.topics[input.topic];
    if (!snapshot || !topic) return { error: "unknown_topic" };
    const questions = topic.examples
      .map((q) => clean(q, QUESTION_CHARS))
      .filter(Boolean)
      .slice(0, 5);
    return {
      key: `insight:${snapshot.id}:${input.topic}`,
      kept: {
        source: "insight",
        snapshotId: snapshot.id,
        topicIndex: input.topic,
        // Its name and counts: what a lesson from it is corroborated by once the run is pruned.
        topic: {
          snapshotId: snapshot.id,
          title: topic.title,
          questions: topic.questions,
          unanswered: topic.unanswered,
        },
        journalId: null,
      },
      title: clean(topic.title, TITLE_CHARS) || undefined,
      summary: clean(topic.summary, SUMMARY_CHARS) || undefined,
      // A topic without examples is read from its name.
      questions: questions.length ? questions : [clean(topic.title, QUESTION_CHARS)],
    };
  }
  const [entry] = await db
    .select({ id: aiJournal.id, messageIds: aiJournal.messageIds })
    .from(aiJournal)
    .where(eq(aiJournal.id, input.entryId));
  if (!entry) return { error: "unknown_entry" };
  const messageId = entry.messageIds[0];
  // The visitor's question, redacted, while the answer is kept (90 days).
  const [message] = messageId
    ? await db
        .select({ question: aiMessages.questionRedacted })
        .from(aiMessages)
        .where(eq(aiMessages.id, messageId))
    : [];
  const question = message ? clean(message.question, QUESTION_CHARS) : "";
  if (!question) return { error: "question_gone" };
  return {
    key: `journal:${entry.id}`,
    kept: {
      source: "journal",
      snapshotId: null,
      topicIndex: null,
      topic: null,
      journalId: entry.id,
    },
    questions: [question],
  };
}

const OPEN: FaqProposalStatus[] = ["proposed", "needs_you"];

/** The source's open proposal, if it has one. */
async function openProposal(source: FaqSource): Promise<FaqProposal | null> {
  const { kept } = source;
  const where =
    kept.source === "insight"
      ? and(
          eq(aiFaqProposals.snapshotId, kept.snapshotId!),
          eq(aiFaqProposals.topicIndex, kept.topicIndex!),
        )
      : eq(aiFaqProposals.journalId, kept.journalId!);
  const [row] = await getDb()
    .select()
    .from(aiFaqProposals)
    .where(and(where, inArray(aiFaqProposals.status, OPEN)))
    .limit(1);
  return row ?? null;
}

/** What the admin reads for each drafted field. */
export const FIELD_NAMES: Record<FaqDraftField, string> = {
  questionEn: "Question (EN)",
  questionDe: "Question (DE)",
  answerEn: "Answer (EN)",
  answerDe: "Answer (DE)",
};

export const CONTENT_GAP =
  "Content gap: the portfolio does not answer this question, so no answer was drafted. Write it yourself, or add it to the portfolio first.";
const notDrafted = (field: FaqDraftField) =>
  `${FIELD_NAMES[field]}: not drafted, no model of the chain answered. Write it yourself, or reject this proposal and draft it again later.`;
const cameEmpty = (field: FaqDraftField) =>
  `${FIELD_NAMES[field]}: every draft came back empty (a safety filter, maybe). Write it yourself.`;
const unanswerable = (field: FaqDraftField) =>
  `${FIELD_NAMES[field]}: not drafted, the question is not one to answer (3 to ${FAQ_QUESTION_MAX} characters). Rewrite it, then draft the answer in the FAQ form.`;

/** A step's draft, recorded in the skills' table; "down" when no model answered. */
interface Drafted {
  text: string;
  useId: string | null;
  abstained: boolean;
  failures: Failure[];
  critic: SkillRun["critic"];
}

async function step(
  session: SkillSession,
  ctx: SkillContext,
  input: Record<string, unknown> & { task: "faq-question" | "faq-answer" | "translate" },
): Promise<Drafted | "down"> {
  const skill = skillFor(input.task);
  const job = await skill.request(input, ctx);
  if (job instanceof SkillAnswer)
    throw new Error(`the ${input.task} step answered without a model`);
  let run: SkillRun;
  try {
    run = await runSkill(session.models, job);
  } catch (error) {
    console.warn(`[faq] the ${input.task} step was not drafted`, (error as Error).message);
    return "down";
  }
  if (!run.text) {
    return { text: "", useId: null, abstained: false, failures: [], critic: null };
  }
  const abstained = skill.abstains(run.text);
  const useId = await recordUse({
    skill: skill.id,
    version: skill.version,
    model: session.model(),
    text: run.text,
    abstained,
    repairs: run.repairs,
    flags: run.failures.map((f) => f.gate),
    candidates: run.candidates.length,
    critic: run.critic?.result ?? null,
    source: "agent",
  }).catch((error: unknown) => {
    console.error("[faq] a draft was not recorded", error);
    return null;
  });
  return {
    text: run.text,
    // An abstention is decided at once: nothing to judge on the admin's decision.
    useId: abstained ? null : useId,
    abstained,
    failures: run.failures,
    critic: run.critic,
  };
}

export type DraftOutcome =
  | { ok: true; proposal: FaqProposal; existing: boolean }
  | { ok: false; error: string; status: 404 | 409 | 502 | 503 };

/** The fields, the uses, the flags and the notes the chain gathers. */
class Gathered {
  readonly texts: Record<FaqDraftField, string> = {
    questionEn: "",
    questionDe: "",
    answerEn: "",
    answerDe: "",
  };
  readonly uses: Partial<Record<FaqDraftField, string>> = {};
  readonly flags: string[] = [];
  readonly notes: string[] = [];
  gap = false;

  keep(field: FaqDraftField, drafted: Drafted): void {
    this.texts[field] = drafted.text;
    if (drafted.useId) this.uses[field] = drafted.useId;
    for (const failure of drafted.failures) {
      this.flags.push(`${field}:${failure.gate}`);
      this.notes.push(`${FIELD_NAMES[field]}: ${failure.message}`);
    }
    for (const note of criticNotes(drafted.critic))
      this.notes.push(`${FIELD_NAMES[field]}: ${note}`);
  }

  /** Whether a step brought text; when not, a note says why (the admin writes the field). */
  drafted(field: FaqDraftField, drafted: Drafted | "down"): drafted is Drafted {
    if (drafted === "down") this.notes.push(notDrafted(field));
    else if (!drafted.text) this.notes.push(cameEmpty(field));
    else return true;
    return false;
  }

  get status(): FaqProposalStatus {
    const missing = Object.values(this.texts).some((text) => !text);
    return this.gap || missing || this.flags.length ? "needs_you" : "proposed";
  }
}

/** The steps after the English question: its German, the answer (or a gap), the answer's German. */
async function draftTheRest(
  session: SkillSession,
  ctx: SkillContext,
  question: string,
  glossary: string[],
  got: Gathered,
): Promise<void> {
  const translate = (text: string, maxLength: number) =>
    step(session, ctx, { task: "translate", text, from: "en", to: "de", maxLength, glossary });
  const questionDe = await translate(question, FAQ_QUESTION_MAX);
  if (got.drafted("questionDe", questionDe)) got.keep("questionDe", questionDe);

  // 2. The answer, grounded in the published portfolio, or a gap: never invented.
  // What `faq-answer` takes (its input's bounds): a draft outside them is the admin's to fix.
  if (question.trim().length < 3 || question.length > FAQ_QUESTION_MAX) {
    got.notes.push(unanswerable("answerEn"));
    return;
  }
  const answer = await step(session, ctx, { task: "faq-answer", question, locale: "en" });
  if (answer !== "down" && answer.abstained) {
    got.gap = true;
    got.notes.push(CONTENT_GAP);
    return;
  }
  if (!got.drafted("answerEn", answer)) return;
  got.keep("answerEn", answer);
  // 3. The answer in German.
  const answerDe = await translate(answer.text, FAQ_ANSWER_MAX);
  if (got.drafted("answerDe", answerDe)) got.keep("answerDe", answerDe);
}

/** The proposal written; the source's open one when another chain's landed first. */
async function store(source: FaqSource, got: Gathered, usd: number): Promise<DraftOutcome> {
  const [row] = await getDb()
    .insert(aiFaqProposals)
    .values({
      ...source.kept,
      ...got.texts,
      uses: got.uses,
      flags: got.flags,
      notes: got.notes,
      usd,
      status: got.status,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return { ok: true, proposal: row, existing: false };
  const open = await openProposal(source);
  if (!open) throw new Error("the FAQ proposal was not stored");
  return { ok: true, proposal: open, existing: true };
}

/** The chain, fenced as `agent`; the proposal it writes, or why there is none. */
async function runChain(source: FaqSource): Promise<DraftOutcome> {
  const config = askConfig();
  const state = await availability(config, await readAiSettings(), "agent");
  if (state.state !== "ok") return { ok: false, error: refusal(state), status: 503 };
  const session = skillModels(config, () => true);
  if (!session.ok) return { ok: false, error: session.error, status: 503 };
  const ctx: SkillContext = { config, corpus: () => askCorpus(config), image: altImage };

  try {
    const glossary = await contentGlossary();
    const got = new Gathered();
    // 1. The question in English: without it there is nothing to propose.
    const question = await step(session, ctx, {
      task: "faq-question",
      locale: "en",
      ...(source.title ? { title: source.title } : {}),
      ...(source.summary ? { summary: source.summary } : {}),
      questions: source.questions,
    });
    if (question === "down") return { ok: false, error: "unavailable", status: 503 };
    if (!question.text) return { ok: false, error: "empty_draft", status: 502 };
    got.keep("questionEn", question);
    await draftTheRest(session, ctx, question.text, glossary, got);
    return await store(source, got, summarizeCalls(session.calls()).usd);
  } finally {
    const calls = session.calls();
    if (calls.length) {
      await recordUsage(calls, "agent").catch((error) =>
        console.error("[faq] the chain's usage was not recorded", error),
      );
    }
  }
}

/** Chains in flight, by source: a second click waits for the first's proposal. */
const drafting = new Map<string, Promise<DraftOutcome>>();

/**
 * A proposal for the source: its open one, as it is (no model call), or a new
 * one from the chain. Refused when the source is gone, the fence is closed,
 * or no model answered the first step.
 */
export async function draftFaqProposal(input: FaqSourceInput): Promise<DraftOutcome> {
  const source = await faqSource(input);
  if ("error" in source) {
    return { ok: false, error: source.error, status: source.error === "question_gone" ? 409 : 404 };
  }
  const open = await openProposal(source);
  if (open) return { ok: true, proposal: open, existing: true };
  const running = drafting.get(source.key);
  if (running !== undefined) {
    const outcome = await running;
    return outcome.ok ? { ...outcome, existing: true } : outcome;
  }
  const chain = runChain(source).finally(() => drafting.delete(source.key));
  drafting.set(source.key, chain);
  return chain;
}
