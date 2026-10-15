import type { Locale } from "../content/schema";
import type { FaqInput } from "./assistant-types";
import { REFUSALS } from "./journal";
import { lessonProblem, lessonRefusal, scopeFromTitle, scopeWords } from "./lessons";

/**
 * The FAQ pipeline's proposals (plan phase 31; the server's
 * `ask/agent/faq-chain.ts` and `faq-decide.ts`): FAQ entries drafted from an
 * insight topic or a journal entry by a chain of checked skills, held until
 * the admin accepts one (then it is an FAQ entry, used at once, its effect
 * measured by a lesson) or rejects it. Shapes and pure helpers for the FAQ
 * tab, Insights and the Journal.
 */

export type FaqProposalStatus = "proposed" | "needs_you" | "accepted" | "rejected";
export type FaqDraftField = "questionEn" | "questionDe" | "answerEn" | "answerDe";

/** A proposal as the server stores it (`ai_faq_proposals`). */
export interface FaqProposalRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: "insight" | "journal";
  snapshotId: string | null;
  topicIndex: number | null;
  /** The topic's run, name and counts (never its example questions). */
  topic: { snapshotId: string; title: string; questions: number; unanswered: boolean } | null;
  journalId: string | null;
  /** The drafts, empty where none was written (a content gap, a step that failed). */
  questionEn: string;
  questionDe: string;
  answerEn: string;
  answerDe: string;
  uses: Partial<Record<FaqDraftField, string>>;
  /** The checks a draft still fails, by field (`answerDe:numbers`). */
  flags: string[];
  /** What the admin reads: a content gap, a step not drafted, a second reading. */
  notes: string[];
  usd: number;
  status: FaqProposalStatus;
  decidedAt: string | null;
  /** The FAQ entry it became, and the lesson that measures it. */
  faqId: string | null;
  lessonId: string | null;
}

/** A proposal as the list gives it: an open one with the lessons it can be measured by. */
export interface FaqProposal extends FaqProposalRow {
  lessons: { id: string; statement: string }[];
  /** Why a new lesson would be refused for it; null when one can be made. */
  newLesson: string | null;
}

/** Where a proposal is drafted from (`POST /admin/assistant/faq-proposals`). */
export type FaqProposalSource =
  { source: "insight"; snapshotId: string; topic: number } | { source: "journal"; entryId: string };

export const isOpenProposal = (p: Pick<FaqProposalRow, "status">): boolean =>
  p.status === "proposed" || p.status === "needs_you";

const STATUS_NAMES: Record<FaqProposalStatus, string> = {
  proposed: "Proposed",
  needs_you: "Needs you",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const proposalStatusName = (status: FaqProposalStatus): string => STATUS_NAMES[status];

const clip = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * "From the insight topic “Relocation” (6 questions, not answered)", or "From
 * a journal entry: “Is he open to relocating?”": its drafted question tells
 * two journal proposals apart, since the line names its card and buttons.
 */
export function sourceLine(
  p: Pick<FaqProposalRow, "source" | "topic" | "questionEn" | "questionDe">,
): string {
  if (p.source === "journal") {
    const asked = p.questionEn.trim() || p.questionDe.trim();
    return asked ? `From a journal entry: “${clip(asked)}”` : "From a journal entry";
  }
  const t = p.topic;
  if (!t) return "From an insight topic";
  const counts = `${t.questions} ${t.questions === 1 ? "question" : "questions"}${t.unanswered ? ", not answered" : ""}`;
  return `From the insight topic “${t.title}” (${counts})`;
}

/** Each FAQ entry an accepted proposal made, and where it came from. */
export function provenanceOf(proposals: readonly FaqProposalRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of proposals) {
    if (p.status !== "accepted" || !p.faqId) continue;
    out.set(
      p.faqId,
      p.source === "insight" ? `From insights: ${p.topic?.title ?? "a topic"}` : "From the journal",
    );
  }
  return out;
}

/** How the entry's effect can be measured: its source's lessons, a new one when allowed, or not at all. */
export function measureChoices(
  p: Pick<FaqProposal, "lessons" | "newLesson">,
): { value: string; label: string }[] {
  return [
    ...p.lessons.map((l) => ({
      value: `lesson:${l.id}`,
      label: `The lesson “${clip(l.statement)}”`,
    })),
    ...(p.newLesson === null ? [{ value: "new", label: "A new lesson, in your words" }] : []),
    { value: "none", label: "Not measured" },
  ];
}

const LOCALES: Locale[] = ["en", "de"];

/** What the admin accepts: the texts (the drafts at first), and how its effect is measured. */
export interface AcceptForm {
  text: Record<Locale, { question: string; answer: string }>;
  visible: boolean;
  /** `lesson:<id>`, `new` or `none`. */
  measure: string;
  /** A new lesson's words and scope. */
  statement: string;
  scope: string;
}

/**
 * The form a proposal opens with: its drafts, measured by its source's lesson
 * or a new one when it can. A new lesson's words start empty: a lesson is the
 * admin's words (Phase 25), never one accepted in a click.
 */
export function acceptForm(p: FaqProposal): AcceptForm {
  return {
    text: {
      en: { question: p.questionEn, answer: p.answerEn },
      de: { question: p.questionDe, answer: p.answerDe },
    },
    visible: true,
    measure: measureChoices(p)[0]!.value,
    statement: "",
    scope: scopeFromTitle(p.topic?.title ?? "").join(", "),
  };
}

/** What a lesson for the topic could say, shown as an example beside the field, never filled in. */
export function lessonExample(p: Pick<FaqProposalRow, "topic">): string {
  const title = p.topic?.title.toLowerCase() ?? "this question";
  return `When visitors ask about ${title}, the FAQ entry answers it from the portfolio.`;
}

/** Why the form cannot be accepted yet; null when it can. */
export function acceptProblem(form: AcceptForm): string | null {
  const filled = LOCALES.filter((l) => form.text[l].question.trim() || form.text[l].answer.trim());
  if (!filled.length) return "Write the entry in at least one language.";
  for (const locale of filled) {
    const { question, answer } = form.text[locale];
    if (question.trim().length < 3 || answer.trim().length < 3) {
      return `Write both the question and the answer in ${locale.toUpperCase()} (3 characters or more), or leave both empty.`;
    }
  }
  if (form.measure !== "new") return null;
  const problem = lessonProblem(form.statement, form.scope);
  return problem ? `${problem} Or choose “Not measured”.` : null;
}

export type AcceptBody = FaqInput & {
  lesson?: { id: string } | { statement: string; scope: string[] };
};

/** What the API takes for an accept: the languages written, and the lesson chosen. */
export function acceptBody(form: AcceptForm): AcceptBody {
  const translations: FaqInput["translations"] = {};
  for (const locale of LOCALES) {
    const { question, answer } = form.text[locale];
    if (question.trim() || answer.trim()) {
      translations[locale] = { question: question.trim(), answer: answer.trim() };
    }
  }
  let lesson: AcceptBody["lesson"];
  if (form.measure.startsWith("lesson:")) lesson = { id: form.measure.slice("lesson:".length) };
  else if (form.measure === "new") {
    lesson = { statement: form.statement.trim(), scope: scopeWords(form.scope) };
  }
  return { isVisible: form.visible, translations, ...(lesson ? { lesson } : {}) };
}

/** The server's refusals and errors here, in words. */
const WORDS: Record<string, string> = {
  ...REFUSALS,
  unknown_topic: "That insights run is gone (runs are kept under 60 days): run insights again.",
  unknown_entry: "That journal entry was deleted.",
  question_gone: "The answer was pruned (after 90 days): there is no question left to draft from.",
  unavailable: "No model of the chain answered: try again later.",
  empty_draft:
    "Every draft came back empty (a safety filter, maybe): write the entry in the FAQ form.",
  assistant_off: "The assistant has no model in this deploy.",
  not_open: "It was decided already, here or in another tab.",
  not_found: "That proposal is gone.",
  invalid_input:
    "Write both the question and the answer of a language (3 characters or more, an answer at most 3000).",
  unknown_lesson: "That lesson was deleted meanwhile.",
  lesson_elsewhere: "That lesson is about something else.",
  lesson_applied: "That lesson was applied meanwhile: pick another, or a new one.",
  lesson_retired: "That lesson was retired: pick another, or a new one.",
  http_404: "This API does not know FAQ proposals yet: deploy the API first.",
  network_error: "The API did not answer: check the connection, then try again.",
  request_failed: "The request failed: try again.",
};

export function faqProposalWords(error: string, detail?: unknown): string {
  if (["not_corroborated", "vague_statement", "empty_scope"].includes(error)) {
    return lessonRefusal(error, detail);
  }
  if (error === "instruction") {
    const locale = (detail as { locale?: unknown } | undefined)?.locale;
    const which = typeof locale === "string" ? ` (${locale.toUpperCase()})` : "";
    return `The question${which} reads as an instruction to the assistant, which the FAQ does not take from a draft: rewrite it.`;
  }
  if (/^http_5\d\d$/.test(error)) {
    return `The API failed (HTTP ${error.slice(5)}): try again; its log says why.`;
  }
  return WORDS[error] ?? error;
}
