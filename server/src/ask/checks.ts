import type { Locale } from "../content/schema.js";
import { NOT_IN_PORTFOLIO, PROMPT_LEAKS } from "./answer-patterns.js";
import { detectLanguage } from "./language.js";

/**
 * Deterministic checks on every finished answer: free, milliseconds, and the
 * first layer of evaluation ("a malformed output cannot be good"). Each flag
 * is stored with the answer (`ai_messages.checks`), shown in Conversations
 * and counted on the Overview; they feed the review queue and, later, the
 * failure journal.
 */

export const CHECK_FLAGS = [
  /** Written in another language than the visitor's (or the page's, when theirs is unclear). */
  "language",
  /** 25 words or more with no citation, and not a decline or an "it isn't there". */
  "uncited",
  /** A piece of the system prompt reached the visitor. */
  "leak",
  /** No words and no action (navigate, hand-off), though nothing failed. */
  "empty",
  /** The model cited a document that does not exist (the marker was removed). */
  "invented-citation",
  /** The answer used every round the agent has: the last one had to answer. */
  "max-rounds",
  /** A fallback or an answer-only model answered, not the chain's first choice. */
  "degraded",
  /** The provider's content filter stopped it. */
  "blocked",
] as const;

export type CheckFlag = (typeof CHECK_FLAGS)[number];

export interface AnswerChecks {
  v: 1;
  flags: CheckFlag[];
}

export interface CheckInput {
  /** The answer as the visitor saw it, citation markers included. */
  text: string;
  locale: Locale;
  /** The visitor's language when it was clear. */
  language: Locale | null;
  droppedCitations: readonly string[];
  toolNames: readonly string[];
  finishReason: string;
  /** Model steps the answer took, and the most it may take. */
  steps: number;
  maxRounds: number;
  degraded: boolean;
}

const MARKERS = /\[\^[^\]]+\]/g;
const HAS_MARKER = /\[\^[^\]]+\]/;
const ACTIONS = new Set(["navigate", "handoff_contact"]);
const UNKNOWN = new RegExp(NOT_IN_PORTFOLIO, "i");
const LEAKS = PROMPT_LEAKS.map((piece) => new RegExp(piece, "i"));
/** An out-of-scope decline: nothing in it to cite. */
const DECLINE =
  /(only (help|answer)|can(not|'t) help|outside (of )?(my|the) scope|nur fragen|nicht (helfen|beantworten))/i;
const UNCITED_WORDS = 25;

export function checkAnswer(input: CheckInput): AnswerChecks {
  const flags: CheckFlag[] = [];
  const prose = input.text.replace(MARKERS, "").trim();
  const failed = input.finishReason.startsWith("error") || input.finishReason === "aborted";

  const detected = detectLanguage(prose);
  if (detected && detected !== (input.language ?? input.locale)) flags.push("language");

  const words = prose.split(/\s+/).filter(Boolean).length;
  if (
    words >= UNCITED_WORDS &&
    !HAS_MARKER.test(input.text) &&
    !UNKNOWN.test(prose) &&
    !DECLINE.test(prose)
  ) {
    flags.push("uncited");
  }

  if (LEAKS.some((leak) => leak.test(input.text))) flags.push("leak");
  if (!prose && !failed && !input.toolNames.some((name) => ACTIONS.has(name))) {
    flags.push("empty");
  }
  if (input.droppedCitations.length) flags.push("invented-citation");
  if (input.steps >= input.maxRounds) flags.push("max-rounds");
  if (input.degraded) flags.push("degraded");
  if (input.finishReason === "content-filter") flags.push("blocked");
  return { v: 1, flags };
}
