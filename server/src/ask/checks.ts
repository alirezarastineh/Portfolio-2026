import type { Locale } from "../content/schema.js";
import { NOT_IN_PORTFOLIO, PROMPT_LEAKS } from "./answer-patterns.js";
import { detectLanguage } from "./language.js";
import { KEY_SHAPES } from "./leak-guard.js";
import { PROMPT_CANARY } from "./prompt.js";

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
  /**
   * The model wrote a piece of the instructions or a secret for a visitor:
   * removed by the output guard (leak-guard.ts), or found afterwards in the
   * answer or a tool's input. Instructions or a key shape the visitor wrote
   * themselves do not count; the canary and the deploy's secrets always do.
   */
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
  /**
   * The visitor's words tried to override the rules, change the assistant's
   * role, escape the visitor fence or extract the instructions (plan phase
   * 15). A signal about the question, not the answer: it blocks nothing, and
   * an answer is not less helpful for it (outcomes.ts).
   */
  "injection-attempt",
] as const;

export type CheckFlag = (typeof CHECK_FLAGS)[number];

/** Flags that describe the visitor's question rather than the answer. */
export const QUESTION_FLAGS: readonly CheckFlag[] = ["injection-attempt"];

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
  /** What the output guard removed before the visitor saw it (leak-guard.ts). */
  guarded?: readonly string[];
  /** The visitor's latest message, for the injection signal. */
  question?: string;
  /** The tools' inputs as text: follow-ups and the hand-off summary reach the visitor too. */
  toolText?: string;
  /** The deploy's secrets (leak-guard.ts `deploySecrets`). */
  secrets?: readonly string[];
}

/** Where a command starts: a line or a sentence, perhaps after "please". */
const COMMAND = String.raw`(?:^|[.!?:;]\s+)\W*(?:please\s+|now\s+|ok(?:ay)?,?\s+)?`;

/**
 * Ways visitors try to turn the assistant (plan phase 15), in English and
 * German: overriding its rules, giving it another role, closing the visitor
 * fence or opening a system turn, and asking for its instructions. Each
 * needs the assistant as its target ("your rules", "you are now", "Sie") or
 * the form of a command (a sentence that starts "Ignore the rules"), so a
 * question about the engineer ("act as a tech lead", "can users override the
 * system prompt", "ignorierte Regeln") is not one. Only signals: the fence
 * and the instructions defend. German "Sie" and "Ihre" count capitalised
 * only: "sie" is also "they", "ihre" also "their".
 */
const INJECTION = [
  // Overriding its rules: its own ("your …"), the earlier ones, or any, as a command.
  /\b(ignore|disregard|forget|override)\b[^.?!\n]{0,20}\byour\b[^.?!\n]{0,20}\b(instruction|rule|prompt|guideline|direction)s?\b/i,
  /\b(ignore|disregard|forget)\b[^.?!\n]{0,20}\b(previous|prior|above|earlier|initial|original)\s+(instruction|rule|prompt|guideline|direction)s?\b/i,
  new RegExp(
    String.raw`${COMMAND}(ignore|disregard|forget)\b[^.?!\n]{0,25}\b(instruction|rule|prompt|guideline|direction)s?\b`,
    "im",
  ),
  /\b(ignore|disregard|forget)\s+(the\s+)?(instructions|rules|prompt)\s+you\s+(were|have been|got)\s+given\b/i,
  // German: an imperative, so it speaks to the assistant ("ignorierte Regeln" does not).
  /\b(ignoriere|ignorier|vergiss|missachte)\b[^.?!\n]{0,30}\b(anweisungen|instruktionen|regeln|vorgaben|systemanweisungen|systemprompts?)\b/i,
  /\b([Ii]gnorieren|[Vv]ergessen|[Mm]issachten) Sie\b[^.?!\n]{0,30}\b(Anweisungen|Instruktionen|Regeln|Vorgaben|Systemanweisungen|Systemprompts?)\b/,
  // Another role: said to the assistant, or as a command.
  /\b(you are now|you're now|from now on,? you (are|will)|you are (now )?(jailbroken|in (developer|dan|god) mode))\b/i,
  new RegExp(
    String.raw`${COMMAND}(pretend (to be|you are|you're)|(enable|enter|activate|switch to) (developer|dan|god) mode)\b`,
    "im",
  ),
  // The classic preamble opens a line; "a developer mode enabled by default" is a question.
  /^[^\w\n]{0,10}(developer|dan|god) mode (enabled|on)\b/im,
  /\b(act as|you are( now)?) DAN\b/,
  /\bact as (if you|an? (unfiltered|uncensored|unrestricted|evil)\b)/i,
  /\b(du bist (jetzt|ab jetzt|nun)|ab (jetzt|sofort) bist du|tu so,? als (ob )?(wärst|bist|wärest) du)\b/i,
  // Closing the fence, or opening a turn of its own.
  /<\/?\s*(visitor|system|assistant|instructions?)\b|\[\/?INST\]|<\|im_(start|end)\|>|<<\s*SYS/i,
  /^[ \t]{0,10}(system|assistant)\s*:/im,
  // Asking for the instructions: the assistant's own, or its system, hidden, initial ones.
  /\b(print|show|reveal|repeat|output|display|dump|give me|translate|encode|what|tell me|list)\b[^.?!\n]{0,30}\byour\b[^.?!\n]{0,20}\b(prompt|instruction|rule|guideline)s?\b/i,
  /\b(print|show|reveal|repeat|output|display|dump|give me|translate|encode)\b[^.?!\n]{0,30}\b(system|hidden|initial|original|secret|confidential|internal)\s+(prompt|instructions|rules)\b/i,
  /\bwhat (were|have) you (been )?told\b/i,
  /\b(repeat|print|show|output|quote|copy|encode|translate)\b[^.?!\n]{0,30}\b(words|text|everything|lines?) (above|before)\b/i,
  /\bbase ?64\b[^.?!\n]{0,60}\b(your|system)\b[^.?!\n]{0,20}\b(prompt|instruction|rule)s?\b/i,
  /\b(your|system)\b[^.?!\n]{0,20}\b(prompt|instruction|rule)s?\b[^.?!\n]{0,60}\bbase ?64\b/i,
  /\bdeine (anweisungen|instruktionen|regeln|vorgaben|systemanweisung\w*)\b/i,
  // "Sie" and "Ihre", capitalised: a formal request, or a question about its rules.
  /\b\w+en Sie\b[^.?!\n]{0,25}\bIhre\s+(Anweisungen|Instruktionen|Regeln|Vorgaben|Systemanweisungen|Systemprompts?)\b/,
  /\b([Ww]as sind|[Ww]ie lauten) Ihre (Anweisungen|Instruktionen|Regeln|Vorgaben|Systemanweisungen)\b/,
  /\b(wiederhol|zeig|gib|druck)\w*\b[^.?!\n]{0,30}\b(wörter|text|alles|zeilen) (über|oberhalb) (dieser|der|meiner) (nachricht|frage|eingabe)\b/i,
];

const MARKERS = /\[\^[^\]]+\]/g;
const HAS_MARKER = /\[\^[^\]]+\]/;
const ACTIONS = new Set(["navigate", "handoff_contact"]);
const UNKNOWN = new RegExp(NOT_IN_PORTFOLIO, "i");
const LEAKS = PROMPT_LEAKS.map((piece) => new RegExp(piece, "i"));
/** An out-of-scope decline: nothing in it to cite. */
const DECLINE =
  /(only (help|answer)|can(not|'t) help|outside (of )?(my|the) scope|nur fragen|nicht (helfen|beantworten))/i;
const UNCITED_WORDS = 25;

/** The canary is a leak whoever wrote it first: pasting it must not hide a translated leak. */
const CANARY = new RegExp(PROMPT_CANARY, "i");

/**
 * Whether a piece of the instructions, a key or a secret is in what the
 * visitor saw (the answer, or a tool's input): found after the output guard,
 * so it got through. A leak piece or a key shape the visitor wrote themselves
 * does not count; the canary and the deploy's secrets always do.
 */
export function leakReached(
  input: Pick<CheckInput, "text" | "question" | "toolText" | "secrets">,
): boolean {
  const shown = `${input.text}\n${input.toolText ?? ""}`;
  const own = (input.question ?? "").toLowerCase();
  const theirs = (pattern: RegExp) => {
    const match = pattern.exec(shown);
    return match !== null && !own.includes(match[0].toLowerCase());
  };
  return (
    CANARY.test(shown) ||
    LEAKS.some(theirs) ||
    KEY_SHAPES.some(theirs) ||
    (input.secrets ?? []).some((s) => s.length >= 8 && shown.includes(s))
  );
}

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

  // Removed by the guard, or found in what was shown: either way it was written.
  if (input.guarded?.length || leakReached(input)) flags.push("leak");
  if (!prose && !failed && !input.toolNames.some((name) => ACTIONS.has(name))) {
    flags.push("empty");
  }
  if (input.droppedCitations.length) flags.push("invented-citation");
  if (input.steps >= input.maxRounds) flags.push("max-rounds");
  if (input.degraded) flags.push("degraded");
  if (input.finishReason === "content-filter") flags.push("blocked");
  const question = input.question ?? "";
  if (INJECTION.some((pattern) => pattern.test(question))) flags.push("injection-attempt");
  return { v: 1, flags };
}
