import { decodeEntities } from "../../content/sanitize.js";
import type { Locale } from "../../content/schema.js";
import { INJECTION_PATTERNS, looksLikeInjection } from "../checks.js";
import type { AskCorpus } from "../corpus/index.js";
import { resolveDocument } from "../corpus/index.js";
import { commonWords } from "../language.js";
import { LANGUAGE, type Gate } from "./skill.js";

/**
 * The skills' gates (plan phase 28, the book's Prompt Chaining gates): code
 * the model cannot change, each checking a necessary condition with a
 * tolerance, never an exact target ("gate tyranny"). A failure says exactly
 * what is wrong ("12 characters over the limit of 155", "missing </strong>"),
 * so the draft can be repaired from it; its id, never its message, is what the
 * drafts' record keeps (a message can quote the draft).
 */

const TAG = /<\/?[a-z][a-z0-9]*\b[^<>]{0,1000}>/gi;

/** What a reader sees: tags out, entities decoded, whitespace collapsed. */
export function visible(text: string): string {
  return decodeEntities(text.replace(/<[^<>]{0,1000}>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** The `items` not found in `pool`, counting repeats. */
function missingFrom(items: readonly string[], pool: readonly string[]): string[] {
  const left = new Map<string, number>();
  for (const item of pool) left.set(item, (left.get(item) ?? 0) + 1);
  const missing: string[] = [];
  for (const item of items) {
    const n = left.get(item) ?? 0;
    if (n) left.set(item, n - 1);
    else missing.push(item);
  }
  return missing;
}

const listed = (items: readonly string[]) =>
  [...new Set(items)].slice(0, 3).join(", ") + (new Set(items).size > 3 ? ", …" : "");

/**
 * At most `cap(p)` characters, counted as the field counts them (markup
 * included: a rich field's limit is on its HTML), when there is a cap.
 */
export function withinLength<P>(cap: (p: P) => number | undefined): Gate<P> {
  return {
    id: "length",
    check: (text, p) => {
      const max = cap(p);
      if (!max || text.length <= max) return null;
      return `${text.length - max} characters over the limit of ${max}`;
    },
  };
}

/**
 * At least `min(p)` characters: a description shorter than that says too
 * little. `rule` names how the minimum is set, for the version.
 */
export function atLeast<P>(min: (p: P) => number, rule: string): Gate<P> {
  return {
    id: "min-length",
    params: rule,
    check: (text, p) => {
      const least = min(p);
      const n = text.trim().length;
      return n >= least ? null : `${n} characters; at least ${least}`;
    },
  };
}

/** Each opening quote and the one that closes it (German »…« included). */
const QUOTE_PAIRS: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "“": "”",
  "„": "“",
  "‚": "‘",
  "‘": "’",
  "«": "»",
  "‹": "›",
  "»": "«",
};
/** A reply, not the text: "Here is the description:", "Sure,", "Hier ist …:", "Alt text:". */
const PREAMBLES: readonly RegExp[] = [
  // "Here is the description:", "Hier sind …:"
  /^\s*(?:here(?:['’]s| is| are)|hier (?:ist|sind))\b[^.:\n]{0,60}:/i,
  // "Sure,", "Gerne!", "Klar:"
  /^\s*(?:sure|certainly|of course|okay|ok|gerne|natürlich|klar)[,!:]/i,
  // "Translation:", "Alt text:", "Antwort:"
  /^\s*(?:translation|übersetzung|description|beschreibung|meta description|search description|alt text|alt-text|alternativtext|answer|antwort)\s*:/i,
];

/** The text itself: no wrapping quotes, no preamble. */
export function bare<P>(): Gate<P> {
  return {
    id: "bare",
    check: (text) => {
      if (PREAMBLES.some((re) => re.test(text)))
        return "starts with a preamble instead of the text itself";
      const t = text.trim();
      const close = QUOTE_PAIRS[t[0] ?? ""];
      const inner = t.slice(1, -1);
      // One quotation around the whole text: `"Atlas" and "Borealis"` is two, and passes.
      const wrapped =
        close !== undefined &&
        t.length > 2 &&
        t.endsWith(close) &&
        !inner.includes(close) &&
        !inner.includes(t[0]!);
      return wrapped ? "wrapped in quotes" : null;
    },
  };
}

/**
 * A text's prose, where its language shows: no markup, citation markers,
 * links or code (an id, a URL or `for…of` is English whatever the text is).
 */
function prose(text: string): string {
  const plain = withoutMarkers(text)
    .replace(/<code\b[^<>]{0,1000}>[^<]*<\/code>/gi, " ")
    .replace(/`[^`\n]+`/g, " ");
  return visible(plain).replace(LINK, " ");
}

/**
 * In the language asked for: refused when the other language's common words
 * outnumber the target's in its prose, so a sentence left untranslated is
 * caught by its "the" or "für". Those words alone count (`commonWords`): a
 * place name with an umlaut ("Senior engineer in Düsseldorf") says nothing,
 * nor does a name with one capitalised ("Red Hat"), and a name or a list of
 * terms, with none of them, passes. A short phrase kept in the other
 * language ("Built with Angular") is flagged: the admin's eye decides.
 */
export function inLanguage<P>(target: (p: P) => Locale): Gate<P> {
  return {
    id: "language",
    params: "common words of the prose: the other's more than the target's",
    check: (text, p) => {
      const want = target(p);
      const other = want === "de" ? "en" : "de";
      const words = commonWords(prose(text));
      return words[other] > words[want]
        ? `written in ${LANGUAGE[other]}, not ${LANGUAGE[want]}`
        : null;
    },
  };
}

/** A tag with its name lower-cased and its whitespace collapsed: how two tags compare. */
function tagsOf(text: string): string[] {
  return (text.match(TAG) ?? []).map((tag) =>
    tag
      .replace(/\s+/g, " ")
      .replace(
        /^<(\/?)([a-z0-9]+)/i,
        (_m, slash: string, name: string) => `<${slash}${name.toLowerCase()}`,
      ),
  );
}

/** The source's HTML tags, every one and no other (as a multiset: order may change). */
export function sameTags<P>(source: (p: P) => string): Gate<P> {
  return {
    id: "tags",
    check: (text, p) => {
      const want = tagsOf(source(p));
      if (!want.length) return null;
      const have = tagsOf(text);
      const missing = missingFrom(want, have);
      const extra = missingFrom(have, want);
      const problems = [
        ...(missing.length ? [`missing ${listed(missing)}`] : []),
        ...(extra.length ? [`tags not in the source: ${listed(extra)}`] : []),
      ];
      return problems.length ? problems.join("; ") : null;
    },
  };
}

/** A no-break space (U+00A0; U+202F is the narrow one): inside a number, never between two. */
const NO_BREAK = String.fromCodePoint(0xa0);
/** What may stand between a number's digits: `.`, `,`, `'`, `’` and the no-break spaces. */
const SEPARATORS = `.,'${String.fromCodePoint(0x2019)}${NO_BREAK}${String.fromCodePoint(0x202f)}`;
/** A number, and the letters written straight after it (3rd, 800ms, 2GB). */
const NUMBER = new RegExp(String.raw`(\d+(?:[${SEPARATORS}]\d+)*)(\p{L}*)`, "gu");
/** An English ordinal's ending: such a number may be spelled out ("3rd-party" → "Drittanbieter"). */
const ORDINAL = /^(?:st|nd|rd|th)$/i;
/** A clock reading: an hour, maybe its minutes after a colon or a stop. */
const CLOCK = String.raw`\d{1,2}(?:[:.]\d{2})?`;
/**
 * A time, or a range of them: "9am", "5 p.m.", "2–4pm", "9.30–17.30 Uhr",
 * "von 9 bis 17 Uhr", "09:00". Bounded, so linear on any text.
 */
const TIME = new RegExp(
  String.raw`\b${CLOCK}(?:\s?(?:[–—-]|bis|to|until)\s?${CLOCK})?\s?(?:[ap]\.?m\.?(?![a-z])|uhr\b|h\b)|\b\d{1,2}:\d{2}\b`,
  "gi",
);

/** A number as both languages write it alike (`numbersOf`). */
export interface Figure {
  value: string;
  /**
   * An English ordinal (3rd) or part of a time (9am, 9–17 Uhr, 09:00): the
   * other language writes it otherwise ("Drittanbieter"; 2–4pm is 14–16 Uhr),
   * so it is never owed, and never new.
   */
  optional: boolean;
}

/**
 * A number's value: a separator before exactly three digits joins a group
 * (2,000 = 2.000 = 2 000), any other is a decimal point (3.5 = 3,5) whose
 * trailing zeros go (20.00 = 20). So 1.5 is not 15, nor 2,000 20.00.
 */
function valueOf(number: string): string {
  const [first = "", ...runs] = number.split(/\D/);
  const value = runs.reduce((v, run) => v + (run.length === 3 ? run : `.${run}`), first);
  const [whole, fraction, ...more] = value.split(".");
  if (fraction === undefined || more.length) return value;
  // Not `/0+$/`: on a long run of zeros ending in another digit it retries from every zero.
  let end = fraction.length;
  while (end > 0 && fraction[end - 1] === "0") end--;
  const trimmed = fraction.slice(0, end);
  return trimmed ? `${whole}.${trimmed}` : whole!;
}

/**
 * The numbers a reader sees, as both languages write them alike: groups
 * joined and decimal points kept (`valueOf`). An ordinary space separates two
 * numbers; a unit written onto one (800ms, 10k) keeps it owed. Times and
 * ordinals are optional: their forms differ between the languages too much
 * to compare, so a changed time is the critic's and the admin's to catch.
 */
export function numbersOf(text: string): Figure[] {
  // Not `visible()`: collapsing whitespace would turn a no-break space (whitespace to a
  // regular expression) into an ordinary one, and split a number written with one in two.
  const plain = decodeEntities(text.replace(/&nbsp;/gi, NO_BREAK).replace(/<[^<>]{0,1000}>/g, " "));
  const times = [...plain.matchAll(TIME)].map((m) => [m.index, m.index + m[0].length] as const);
  let t = 0;
  return [...plain.matchAll(NUMBER)].map((m) => {
    // Both in text order: the times that end before this number are behind it.
    while (t < times.length && times[t]![1] <= m.index) t++;
    const inTime = t < times.length && times[t]![0] <= m.index;
    return { value: valueOf(m[1]!), optional: inTime || ORDINAL.test(m[2]!) };
  });
}

const valuesOf = (figures: readonly Figure[]) => new Set(figures.map((f) => f.value));

/** The numbers a text must account for: each once, ordinals and times aside. */
const owed = (figures: readonly Figure[]) => [
  ...new Set(figures.filter((f) => !f.optional).map((f) => f.value)),
];

/**
 * Every number of the source and no other: a fact neither lost nor invented.
 * Each counts once (a tightened text may drop a repeat); an ordinal or a
 * time may be written otherwise (`numbersOf`), so neither is owed.
 */
export function sameNumbers<P>(source: (p: P) => string): Gate<P> {
  return {
    id: "numbers",
    params: "values, once each; ordinals and times optional",
    check: (text, p) => {
      const want = numbersOf(source(p));
      const have = numbersOf(text);
      const [wanted, had] = [valuesOf(want), valuesOf(have)];
      const missing = owed(want).filter((n) => !had.has(n));
      const extra = owed(have).filter((n) => !wanted.has(n));
      const problems = [
        ...(missing.length ? [`a number changed or missing: ${listed(missing)}`] : []),
        ...(extra.length ? [`a number not in the source: ${listed(extra)}`] : []),
      ];
      return problems.length ? problems.join("; ") : null;
    },
  };
}

// Bounded: no run of the admin's text can make it backtrack for long.
const LINK = /\bhttps?:\/\/[^\s"'<>)\]]{1,2000}|[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;

/** The links and e-mail addresses in a text, a sentence's closing stop left off. */
function linksOf(text: string): string[] {
  return (text.match(LINK) ?? []).map((link) => link.replace(/[.,;:!?]{1,8}$/, ""));
}

/** Every link and e-mail address of the source, unchanged. */
export function sameLinks<P>(source: (p: P) => string): Gate<P> {
  return {
    id: "links",
    check: (text, p) => {
      const have = new Set(linksOf(text));
      const missing = [...new Set(linksOf(source(p)))].filter((link) => !have.has(link));
      return missing.length ? `a link changed or missing: ${listed(missing)}` : null;
    },
  };
}

/** Every piece of inline code of the source (`<code>` or backticks), unchanged. */
export function sameCode<P>(source: (p: P) => string): Gate<P> {
  return {
    id: "code",
    check: (text, p) => {
      const src = source(p);
      const spans = [
        ...[...src.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)].map((m) => m[1]!),
        ...[...src.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!),
      ].filter((span) => span.trim());
      const missing = spans.filter((span) => !text.includes(span));
      return missing.length ? `inline code changed: ${listed(missing)}` : null;
    },
  };
}

/** Below this many visible characters, two languages' lengths differ too much to compare. */
const RATIO_FROM = 40;

/** The visible length within `min`–`max` times the source's (a sentence dropped or added). */
export function lengthRatio<P>(source: (p: P) => string, min: number, max: number): Gate<P> {
  return {
    id: "ratio",
    params: [min, max, RATIO_FROM],
    check: (text, p) => {
      const from = visible(source(p)).length;
      if (from < RATIO_FROM) return null;
      const ratio = visible(text).length / from;
      return ratio < min || ratio > max
        ? `${Math.round(ratio * 100)} % of the source's length (${Math.round(min * 100)}–${Math.round(max * 100)} % expected)`
        : null;
    },
  };
}

/** Shorter than the source: the point of tightening. */
export function shorter<P>(source: (p: P) => string): Gate<P> {
  return {
    id: "shorter",
    check: (text, p) => {
      const from = visible(source(p)).length;
      const to = visible(text).length;
      return to < from ? null : `not shorter than the original (${to} against ${from} characters)`;
    },
  };
}

const IMAGE_OF: readonly RegExp[] = [
  // "An image of", "Photo showing"
  /^\s*(?:(?:an?|the)\s+)?(?:image|picture|photo|photograph|graphic)\s+(?:of|showing)\b/i,
  // "Ein Bild von", "Foto zeigt"
  /^\s*(?:(?:ein|das)\s+)?(?:bild|foto|grafik)\s+(?:von|zeigt)\b/i,
];

/** Alt text that says what is shown, not that it is a picture (a screenshot or diagram may be named). */
export function noImageOf<P>(): Gate<P> {
  return {
    id: "no-image-of",
    check: (text) =>
      IMAGE_OF.some((re) => re.test(text))
        ? 'starts with "image of": say what it shows instead'
        : null,
  };
}

/** The FAQ's abstention, written alone. */
export const NO_ANSWER = "NO_ANSWER";

const MARKER = /\s?\[\^([^\]\s]{1,160})\]/g;

/** The ids an answer cites, `[^id]`, in order. */
export function citedIds(text: string): string[] {
  return [...text.matchAll(MARKER)].map((m) => m[1]!);
}

/** The answer without its citation markers, and without a space left before a stop. */
export function withoutMarkers(text: string): string {
  return (
    text
      .replace(MARKER, "")
      // Each run of spaces matched once, whatever follows it: linear on any run.
      .replace(/[ \t]+([.,;:!?])?/g, (spaces, stop: string | undefined) => stop ?? spaces)
      .trim()
  );
}

const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** `NO_ANSWER` alone, or an answer of at most `max` words (its markers aside). */
export function answerShape<P>(max: number): Gate<P> {
  return {
    id: "answer",
    params: max,
    check: (text) => {
      const t = text.trim();
      if (t === NO_ANSWER) return null;
      if (t.includes(NO_ANSWER))
        return `${NO_ANSWER} with other text: write either the answer or ${NO_ANSWER} alone`;
      const words = wordsIn(withoutMarkers(t));
      return words > max ? `${words} words; at most ${max}` : null;
    },
  };
}

/** What a grounded FAQ answer is checked against: the published corpus, in its language. */
export interface Grounding {
  corpus: Pick<AskCorpus, "byId">;
  locale: Locale;
}

/** An answer cites its documents, and only documents the portfolio has. */
export function cited<P>(grounding: (p: P) => Grounding): Gate<P> {
  return {
    id: "cited",
    check: (text, p) => {
      if (text.trim() === NO_ANSWER) return null;
      const ids = citedIds(text);
      if (!ids.length)
        return "cites no document: cite each fact as [^id], with the id from its document's header";
      const { corpus, locale } = grounding(p);
      const unknown = ids.filter((id) => !resolveDocument(corpus, id, locale));
      return unknown.length
        ? `cites a document the portfolio does not have: ${listed(unknown)}`
        : null;
    },
  };
}

/** Every number an answer states appears in a document it cites. */
export function grounded<P>(grounding: (p: P) => Grounding): Gate<P> {
  return {
    id: "grounded",
    check: (text, p) => {
      if (text.trim() === NO_ANSWER) return null;
      const { corpus, locale } = grounding(p);
      const evidence = new Set(
        citedIds(text).flatMap((id) => {
          const doc = resolveDocument(corpus, id, locale);
          return doc ? numbersOf(doc.text).map((f) => f.value) : [];
        }),
      );
      // Every figure it owes, a unit's too: an answer must not invent a "10x". Times and
      // ordinals are written otherwise in a document's other language (`numbersOf`).
      const unsupported = owed(numbersOf(withoutMarkers(text))).filter((n) => !evidence.has(n));
      return unsupported.length
        ? `states ${listed(unsupported)}, which no cited document does`
        : null;
    },
  };
}

/** One question on one line, as an FAQ lists it (plan phase 31): one question mark, at the end. */
export function oneQuestion<P>(): Gate<P> {
  return {
    id: "question",
    check: (text) => {
      const t = text.trim();
      if (/[\r\n]/.test(t)) return "more than one line: write the question on one line";
      const marks = t.match(/[?？]/g)?.length ?? 0;
      if (!/[?？]$/.test(t)) return "does not end with a question mark";
      return marks > 1 ? "asks more than one question: ask one" : null;
    },
  };
}

/**
 * Not an order to the assistant (plan phase 31): a question drafted from
 * visitors' questions must not carry an injection into the FAQ, which the
 * assistant reads as its own knowledge (`checks.ts` patterns).
 */
export function notAnInstruction<P>(): Gate<P> {
  return {
    id: "instruction",
    params: INJECTION_PATTERNS,
    check: (text) =>
      looksLikeInjection(text)
        ? "reads as an instruction to the assistant: ask what the visitors wanted to know"
        : null,
  };
}
