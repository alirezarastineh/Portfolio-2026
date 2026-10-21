import { decodeEntities } from "../content/sanitize.js";

/**
 * The numbers a text states, read the same way wherever numbers are
 * compared: the skills' gates (skills/gates.ts, plan phase 28) and the
 * ungrounded-figure check on answers (checks.ts, visitor plan V7).
 */

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
  /**
   * What is written onto it: its letters (800ms, 10x, 2GB), a percent sign
   * after it, or a currency sign before or after it; empty for a bare number.
   */
  unit: string;
}

/** A percent or currency sign after a number, a space allowed between (German writes "40 %"). */
const SIGN_AFTER = new RegExp(
  `^[ ${NO_BREAK}${String.fromCodePoint(0x202f)}]?([%‰€$£])`,
  "u",
);
/** A currency sign before a number. */
const SIGN_BEFORE = /[€$£] ?$/u;

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
    const after = SIGN_AFTER.exec(plain.slice(m.index + m[0].length, m.index + m[0].length + 2));
    const before = SIGN_BEFORE.exec(plain.slice(Math.max(0, m.index - 2), m.index));
    return {
      value: valueOf(m[1]!),
      optional: inTime || ORDINAL.test(m[2]!),
      unit: m[2] || after?.[1] || before?.[0].trim() || "",
    };
  });
}
