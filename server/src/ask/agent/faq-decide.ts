import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { DbExecutor } from "../../content/build.js";
import { getDb } from "../../db/client.js";
import {
  aiFaqProposals,
  aiJournal,
  aiLessons,
  type FaqDraftField,
  type FaqProposalStatus,
} from "../../db/schema.js";
import { audit } from "../audit.js";
import { faqInput, insertFaq, type FaqInput } from "../faq.js";
import { HEURISTIC_MIN_WORDS } from "../journal.js";
import { cleanScope, corroborationProblem } from "../lessons.js";
import { invalidateAssistantCache } from "../settings.js";
import type { FaqProposal } from "./faq-chain.js";
import { decideUse, verdictOn } from "./verdicts.js";

/**
 * The admin's decisions on the FAQ proposals (plan phase 31, the book's
 * Approval Gate): accept writes the admin's final text as an FAQ entry, live
 * at once (as the FAQ form's Save), links it to its source, and starts
 * measuring it (Phase 25: a lesson applied as this entry); reject closes the
 * proposal. Each in one transaction that locks the proposal first; a refusal
 * writes nothing. Each decision is audited and decides the drafts' skill uses.
 */

export const FAQ_PROPOSAL_STATUSES = [
  "proposed",
  "needs_you",
  "accepted",
  "rejected",
] as const satisfies readonly FaqProposalStatus[];

const isOpen = (p: Pick<FaqProposal, "status">) =>
  p.status === "proposed" || p.status === "needs_you";

/** How the entry is measured: a lesson from the same source, or a new one for the topic. */
const lessonChoice = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({
    statement: z.string().trim().min(1).max(500),
    scope: z.array(z.string().max(60)).min(1).max(40),
  }),
]);

/** What accepting takes: the entry as the FAQ form saves it, and how to measure it (none: not measured). */
export const acceptInput = faqInput.extend({ lesson: lessonChoice.optional() });
export type AcceptInput = z.infer<typeof acceptInput>;

const JOURNAL_LESSON =
  "a lesson from the journal needs 3 accepted or fixed entries: make it in the Journal, then link it here";

type Refusal =
  | { ok: false; error: "not_found"; status: 404 }
  | {
      ok: false;
      error: "not_open" | "lesson_applied" | "lesson_retired";
      status: 409;
    }
  | {
      ok: false;
      error: "unknown_lesson" | "lesson_elsewhere" | "vague_statement" | "empty_scope";
      status: 400;
    }
  | { ok: false; error: "not_corroborated"; status: 400; reason: string };

export type FaqDecision =
  | { ok: true; proposal: FaqProposal; linked: { journal: boolean; lesson: string | null } }
  | Refusal;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

type Lesson = typeof aiLessons.$inferSelect;

/** Whether a lesson is about the proposal's source: the same topic (by name, any run), or naming the entry. */
function fromSource(lesson: Pick<Lesson, "source" | "topic" | "journalIds">, p: FaqProposal) {
  if (p.source === "insight") {
    return lesson.source === "insight" && !!p.topic && lesson.topic?.title === p.topic.title;
  }
  return lesson.source === "journal" && !!p.journalId && lesson.journalIds.includes(p.journalId);
}

/** Why a new lesson for this proposal would not be kept; null when it would. */
export function newLessonProblem(p: Pick<FaqProposal, "source" | "topic">): string | null {
  if (p.source !== "insight" || !p.topic) return JOURNAL_LESSON;
  return corroborationProblem({ source: "insight", topic: p.topic });
}

type LessonPlan = { link: string } | { create: { statement: string; scope: string[] } } | null;

/** The lesson the accept applies, checked before anything is written. */
async function planLesson(
  tx: DbExecutor,
  p: FaqProposal,
  choice: AcceptInput["lesson"],
): Promise<LessonPlan | Refusal> {
  if (!choice) return null;
  if ("id" in choice) {
    const [lesson] = await tx
      .select()
      .from(aiLessons)
      .where(eq(aiLessons.id, choice.id))
      .for("update");
    if (!lesson) return { ok: false, error: "unknown_lesson", status: 400 };
    if (!fromSource(lesson, p)) return { ok: false, error: "lesson_elsewhere", status: 400 };
    if (lesson.status === "retired") return { ok: false, error: "lesson_retired", status: 409 };
    if (lesson.appliedAt || lesson.status !== "proposed") {
      return { ok: false, error: "lesson_applied", status: 409 };
    }
    return { link: lesson.id };
  }
  const problem = newLessonProblem(p);
  if (problem) return { ok: false, error: "not_corroborated", status: 400, reason: problem };
  if (words(choice.statement) < HEURISTIC_MIN_WORDS) {
    return { ok: false, error: "vague_statement", status: 400 };
  }
  const scope = cleanScope(choice.scope);
  if (!scope.length) return { ok: false, error: "empty_scope", status: 400 };
  return { create: { statement: choice.statement, scope } };
}

/** The lesson applied as the FAQ entry, measured from now (as `PATCH /lessons/:id` applies one). */
async function applyLesson(
  tx: DbExecutor,
  plan: Exclude<LessonPlan, null>,
  p: FaqProposal,
  faqId: string,
): Promise<string> {
  const applied = {
    appliedAs: "faq" as const,
    appliedRef: faqId,
    appliedAt: sql`now()`,
    reopenedAt: null,
    status: "active" as const,
  };
  if ("link" in plan) {
    await tx
      .update(aiLessons)
      .set({ ...applied, updatedAt: sql`now()` })
      .where(eq(aiLessons.id, plan.link));
    return plan.link;
  }
  const [row] = await tx
    .insert(aiLessons)
    .values({
      statement: plan.create.statement,
      scope: plan.create.scope,
      source: "insight",
      journalIds: [],
      topic: p.topic,
      ...applied,
    })
    .returning({ id: aiLessons.id });
  return row!.id;
}

/**
 * The journal entry's fix becomes this FAQ entry, when it names no other: no
 * reference yet, and no fix type or the FAQ's. Its status stays the admin's.
 */
async function linkEntry(tx: DbExecutor, journalId: string, faqId: string): Promise<boolean> {
  const rows = await tx
    .update(aiJournal)
    .set({ fixType: "faq", fixRef: faqId, updatedAt: sql`now()` })
    .where(
      and(
        eq(aiJournal.id, journalId),
        or(isNull(aiJournal.fixRef), eq(aiJournal.fixRef, "")),
        or(isNull(aiJournal.fixType), eq(aiJournal.fixType, "faq")),
      ),
    )
    .returning({ id: aiJournal.id });
  return rows.length > 0;
}

/** What the admin reads of a proposal's source, for the audit log. */
export function sourceLabel(p: Pick<FaqProposal, "source" | "topic" | "journalId">): string {
  return p.source === "insight"
    ? `the insight topic "${p.topic?.title ?? "?"}"`
    : `the journal entry ${p.journalId ?? "(deleted)"}`;
}

const FIELDS: { field: FaqDraftField; locale: "en" | "de"; part: "question" | "answer" }[] = [
  { field: "questionEn", locale: "en", part: "question" },
  { field: "questionDe", locale: "de", part: "question" },
  { field: "answerEn", locale: "en", part: "answer" },
  { field: "answerDe", locale: "de", part: "answer" },
];

/** Each draft decided by what the admin kept: as it was, edited, or a field left out (discarded). */
async function decideDrafts(p: FaqProposal, kept: FaqInput["translations"] | null): Promise<void> {
  await Promise.all(
    FIELDS.map(({ field, locale, part }) => {
      const text = kept?.[locale]?.[part] ?? "";
      return decideUse(
        p.uses[field],
        text ? verdictOn(p[field], text) : { outcome: "discarded", distance: null },
      );
    }),
  );
}

/**
 * A decided proposal keeps no text: its drafts are model paraphrases of what
 * visitors asked, done with once decided (the entry holds the admin's words,
 * and the drafts' verdicts are in the skills' table). Its source, counts and
 * links stay.
 */
const decided = () => ({
  questionEn: "",
  questionDe: "",
  answerEn: "",
  answerDe: "",
  notes: [] as string[],
  decidedAt: sql`now()`,
  updatedAt: sql`now()`,
});

async function locked(tx: DbExecutor, id: string): Promise<FaqProposal | null> {
  const [row] = await tx
    .select()
    .from(aiFaqProposals)
    .where(eq(aiFaqProposals.id, id))
    .for("update");
  return row ?? null;
}

/**
 * Accepts a proposal with the admin's final text: the FAQ entry, its source
 * linked, its measure started. A refusal (the lesson, a decided proposal)
 * writes nothing.
 */
export async function acceptFaqProposal(id: string, input: AcceptInput): Promise<FaqDecision> {
  const outcome = await getDb().transaction(async (tx) => {
    const p = await locked(tx, id);
    if (!p) return { ok: false, error: "not_found", status: 404 } as const;
    if (!isOpen(p)) return { ok: false, error: "not_open", status: 409 } as const;
    const plan = await planLesson(tx, p, input.lesson);
    if (plan && "ok" in plan) return plan;

    const faqId = await insertFaq(tx, {
      isVisible: input.isVisible,
      translations: input.translations,
    });
    const journal = p.journalId ? await linkEntry(tx, p.journalId, faqId) : false;
    const lesson = plan ? await applyLesson(tx, plan, p, faqId) : null;
    const [accepted] = await tx
      .update(aiFaqProposals)
      .set({ ...decided(), status: "accepted", faqId, lessonId: lesson })
      .where(eq(aiFaqProposals.id, id))
      .returning();
    const said = [
      `the FAQ entry ${faqId}, from ${sourceLabel(p)}`,
      ...(journal ? ["the entry's fix"] : []),
      lesson ? `measured by the lesson ${lesson}` : "not measured",
    ];
    await audit(
      {
        actor: "admin",
        action: "faq.accept",
        target: id,
        decision: "allowed",
        reason: said.join("; "),
      },
      tx,
    );
    return { ok: true, proposal: accepted!, linked: { journal, lesson }, drafted: p } as const;
  });
  if (!outcome.ok) return outcome;
  // Live from now: the assistant reads the FAQ again.
  invalidateAssistantCache();
  await decideDrafts(outcome.drafted, input.translations);
  return { ok: true, proposal: outcome.proposal, linked: outcome.linked };
}

/** Rejects a proposal: nothing is written to the FAQ; its drafts were not kept. */
export async function rejectFaqProposal(id: string): Promise<FaqDecision> {
  const outcome = await getDb().transaction(async (tx) => {
    const p = await locked(tx, id);
    if (!p) return { ok: false, error: "not_found", status: 404 } as const;
    if (!isOpen(p)) return { ok: false, error: "not_open", status: 409 } as const;
    const [rejected] = await tx
      .update(aiFaqProposals)
      .set({ ...decided(), status: "rejected" })
      .where(eq(aiFaqProposals.id, id))
      .returning();
    await audit(
      {
        actor: "admin",
        action: "faq.reject",
        target: id,
        decision: "allowed",
        reason: `from ${sourceLabel(p)}`,
      },
      tx,
    );
    return { ok: true, proposal: rejected! } as const;
  });
  if (!outcome.ok) return outcome;
  await decideDrafts(outcome.proposal, null);
  return { ok: true, proposal: outcome.proposal, linked: { journal: false, lesson: null } };
}

/** The unapplied lessons read for the list's choices, newest first (the lessons list shows 200). */
const CANDIDATES = 200;

/** A lesson an open proposal can be measured by: one from its source, not applied yet. */
export interface CandidateLesson {
  id: string;
  statement: string;
}

export type ListedFaqProposal = FaqProposal & {
  /** For an open one: the lessons it can link, and why a new one would be refused (null: it would not). */
  lessons: CandidateLesson[];
  newLesson: string | null;
};

/** The proposals in some statuses (all when none), newest first, each open one with its lesson choices. */
export async function listFaqProposals(
  statuses: readonly FaqProposalStatus[],
  limit: number,
): Promise<ListedFaqProposal[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(aiFaqProposals)
    .where(statuses.length ? inArray(aiFaqProposals.status, [...statuses]) : undefined)
    .orderBy(desc(aiFaqProposals.createdAt), desc(aiFaqProposals.id))
    .limit(limit);
  const open = rows.filter(isOpen);
  // The lessons not applied yet: few (the admin writes each).
  const unapplied = open.length
    ? await db
        .select({
          id: aiLessons.id,
          statement: aiLessons.statement,
          source: aiLessons.source,
          topic: aiLessons.topic,
          journalIds: aiLessons.journalIds,
        })
        .from(aiLessons)
        .where(and(eq(aiLessons.status, "proposed"), isNull(aiLessons.appliedAt)))
        .orderBy(desc(aiLessons.createdAt))
        .limit(CANDIDATES)
    : [];
  return rows.map((p) =>
    isOpen(p)
      ? {
          ...p,
          lessons: unapplied
            .filter((lesson) => fromSource(lesson, p))
            .map(({ id, statement }) => ({ id, statement })),
          newLesson: newLessonProblem(p),
        }
      : { ...p, lessons: [], newLesson: null },
  );
}
