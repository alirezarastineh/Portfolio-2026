import type { Locale } from "../content/schema.js";
import { cleanVisitorText } from "./history.js";
import { detectLanguage } from "./language.js";
import { personalPieces } from "./log.js";

/**
 * A hand-off to the contact form (plan phase 11): the conversation it came
 * from goes with the message only when the visitor ticks "attach". It holds
 * what the log already keeps (the redacted question and the answer excerpt)
 * for that one session, oldest first, up to the answer the offer came with.
 *
 * The offer itself (visitor plan V6) is made by the model's `handoff_contact`
 * or, when the visitor asked to reach him and the model offered nothing, by
 * the server. Either way its summary is checked before it reaches the form.
 */

/** The most of the visitor's own words a summary takes. */
export const OWN_WORDS_CHARS = 300;

/** A link: what a summary must not add. */
const LINK = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi;
/** A claim that something went out already, in either language. */
const SENT =
  /\b(?:sent|forwarded|emailed|delivered|submitted|gesendet|geschickt|verschickt|übermittelt|weitergeleitet|zugestellt)\b/i;

/** Why the model's summary may not go to the form; null when it may. */
export type SummaryProblem = "missing" | "language" | "added-contact" | "claims-sent";

/**
 * The summary gate: the model's summary must be in the visitor's language,
 * add no email, phone number or link the visitor did not write (the own-text
 * rule `leakReached` uses: what the visitor wrote may come back), and claim
 * nothing was sent: the visitor confirms first.
 */
export function summaryProblem(
  summary: unknown,
  visitor: { question: string; language: Locale },
): SummaryProblem | null {
  if (typeof summary !== "string" || !summary.trim()) return "missing";
  const detected = detectLanguage(summary);
  if (detected && detected !== visitor.language) return "language";
  const own = visitor.question.toLowerCase();
  const added = [...personalPieces(summary), ...[...summary.matchAll(LINK)].map((m) => m[0])];
  if (added.some((piece) => !own.includes(piece.toLowerCase()))) return "added-contact";
  if (SENT.test(summary)) return "claims-sent";
  return null;
}

/** The visitor's own question as a summary: cleaned, on one line, cut at a word. */
export function ownWords(question: string): string {
  const text = cleanVisitorText(question).replace(/\s+/g, " ");
  if (text.length <= OWN_WORDS_CHARS) return text;
  const cut = text.slice(0, OWN_WORDS_CHARS - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > OWN_WORDS_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The hand-off an answer offers, as its finish says it, and its trace. */
export interface HandoffOffer {
  /** The model's tool call, or the server, when the visitor asked and the model did not. */
  by: "tool" | "fallback";
  /** What the form is filled with: the model's summary if it passed, else the visitor's words. */
  summary: string;
  /** The gate refused the model's summary, and the visitor's words replaced it. */
  replaced?: true;
}

/**
 * The offer an answer makes, if any: the model's, with its summary gated; or
 * the server's own, when the visitor asked to reach him, the answer finished,
 * and it did not already open the contact section.
 */
export function handoffOffer(input: {
  /** The router's `intent` (router.ts `contactIntentOf`). */
  intent: boolean;
  /** The model's `handoff_contact` input, when it called it. */
  call: { input: unknown } | null;
  finished: boolean;
  /** It opened the contact section already (`navigate` to `#contact`). */
  openedContact: boolean;
  question: string;
  /** The answer's language: the visitor's when clear, else the page's. */
  language: Locale;
}): HandoffOffer | null {
  if (input.call) {
    const summary = (input.call.input as { summary?: unknown } | null)?.summary;
    if (summaryProblem(summary, input) === null) {
      return { by: "tool", summary: (summary as string).trim() };
    }
    return { by: "tool", summary: ownWords(input.question), replaced: true };
  }
  if (!input.intent || !input.finished || input.openedContact) return null;
  return { by: "fallback", summary: ownWords(input.question) };
}

/** At most this many turns: the end of a conversation is what the reply needs. */
export const TRANSCRIPT_TURNS = 10;

export interface AskTranscript {
  v: 1;
  turns: { question: string; answer: string; cited: string[]; at: string }[];
}

export function buildTranscript(
  rows: readonly { question: string; answer: string; cited: string[]; createdAt: Date }[],
): AskTranscript {
  const recent = [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-TRANSCRIPT_TURNS);
  return {
    v: 1,
    turns: recent.map((row) => ({
      question: row.question,
      answer: row.answer,
      cited: row.cited,
      at: row.createdAt.toISOString(),
    })),
  };
}
