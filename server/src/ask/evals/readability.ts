import type { Locale } from "../../content/schema.js";

/**
 * How easy an answer is to read (visitor plan V10's plain level): its average
 * sentence length and its share of long words, the two halves of LIX
 * (Björnsson), which reads English and German alike with a bound per
 * language: German compounds make more long words. Pure. Code, citation
 * markers and Markdown's marks are left out before counting; each line of a
 * list is a sentence of its own.
 */

export interface Readability {
  words: number;
  sentences: number;
  /** Words per sentence; 0 without any. */
  sentenceLength: number;
  /** Words of more than six letters, as a share of all words; 0 without any. */
  longShare: number;
}

/** A word: anything between spaces with a letter or a digit in it. */
const WORD = /[\p{L}\p{N}]/u;

/** Prose without code, citation markers and Markdown's emphasis and list marks. */
function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\[\^[^\]]+\]/g, "")
    .replace(/[*_]{1,2}/g, "")
    .replace(/^[ \t]*(?:[-•]|\d+\.)[ \t]+/gm, "");
}

/** The words of `text` as the bounds count them. */
export function wordsOf(text: string): string[] {
  return prose(text)
    .split(/\s+/)
    .filter((token) => WORD.test(token));
}

export function readability(text: string): Readability {
  // LIX ends a sentence at a colon too.
  const sentences = prose(text)
    .split(/(?<=[.!?…:])\s+|\n+/)
    .filter((sentence) => WORD.test(sentence));
  const words = sentences.flatMap((sentence) =>
    sentence.split(/\s+/).filter((token) => WORD.test(token)),
  );
  const long = words.filter((word) => (word.match(/\p{L}/gu)?.length ?? 0) > 6).length;
  return {
    words: words.length,
    sentences: sentences.length,
    sentenceLength: sentences.length ? words.length / sentences.length : 0,
    longShare: words.length ? long / words.length : 0,
  };
}

/**
 * What the plain level allows, per language: plain English stays near 10–15
 * words a sentence with a quarter to a third of its words long (the
 * portfolio's own names count); German, with shorter sentences and its
 * compounds, nearer two fifths.
 */
export const PLAIN_BOUNDS: Record<Locale, { sentenceLength: number; longShare: number }> = {
  en: { sentenceLength: 20, longShare: 0.35 },
  de: { sentenceLength: 16, longShare: 0.45 },
};

/** Why an answer is not plain in `language`; empty when it is. */
export function notPlain(text: string, language: Locale): string[] {
  const r = readability(text);
  const bounds = PLAIN_BOUNDS[language];
  const failures: string[] = [];
  if (r.sentenceLength > bounds.sentenceLength) {
    failures.push(
      `not plain: ${r.sentenceLength.toFixed(1)} words a sentence (at most ${bounds.sentenceLength})`,
    );
  }
  if (r.longShare > bounds.longShare) {
    failures.push(
      `not plain: ${Math.round(r.longShare * 100)} % long words (at most ${Math.round(bounds.longShare * 100)} %)`,
    );
  }
  return failures;
}
