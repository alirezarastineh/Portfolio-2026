import type { ModelMessage } from "ai";

/**
 * The conversation window (plan phase 22, compaction level 1): when the
 * history no longer fits, the oldest turns go, and the answer gets a short,
 * deterministic note of what went, built from the visitor's own earlier
 * questions, never from a model: how many, and their most frequent words.
 * Summarising with a model stays deferred (decision D5).
 *
 * The note stands outside the visitor fence, and those questions are only
 * schema-checked (the browser sends them, unsigned): so the note names no
 * more than three words, each 3 to 24 letters or digits in Latin script (the
 * site's two languages). A sentence cannot get through, whatever it is
 * written in.
 */

/** How many topic words the note names. */
export const NOTE_TOPICS = 3;
/** The longest topic word. */
export const TOPIC_CHARS = 24;
const TOPIC_WORD = new RegExp(String.raw`^[\p{Script=Latin}\p{N}]{3,${TOPIC_CHARS}}$`, "u");

/** Words no question is about, in English and German. */
const FUNCTION_WORDS = new Set(
  (
    "what where when which who whom whose why how does did done doing are was were has have had his him " +
    "the and for with about from into this that these those can could would should will any some your " +
    "you tell know more also there their they been being his her its our out not but all one " +
    "wer wann was welche welcher welches welchen welchem wie warum ist sind war waren hat hatte hast " +
    "sein seine seiner seinen seinem ihm ihn der die das den dem des ein eine einen einem einer und " +
    "oder von vom auf für mit über bei mir mich kann könnte würde gibt noch auch mehr schon sich nicht"
  ).split(" "),
);

/** One answer as the window's measure reads it: its session and what its trace says. */
export interface WindowRow {
  id: string;
  sessionHash: string;
  trace: { window?: { dropped: number } } | null;
}

export interface WindowMetrics {
  sessions: number;
  /** Sessions with at least one answer whose history the window trimmed. */
  sessionsTrimmed: number;
  /** Answers given after a trim, and how many of them the visitor then rephrased. */
  afterTrim: { answers: number; rephrased: number };
  otherwise: { answers: number; rephrased: number };
}

/**
 * The plan's two measures: the share of sessions trimmed, and rephrases after
 * a trim against the rest (did the note keep the thread?). Only answers whose
 * trace records the window count: one from before plan phase 22 cannot say
 * whether it was trimmed.
 */
export function measureWindow(
  rows: readonly WindowRow[],
  rephrased: ReadonlySet<string>,
): WindowMetrics {
  const known = rows.filter((row) => row.trace?.window !== undefined);
  const trimmed = (row: WindowRow) => row.trace!.window!.dropped > 0;
  const tally = (list: readonly WindowRow[]) => ({
    answers: list.length,
    rephrased: list.filter((row) => rephrased.has(row.id)).length,
  });
  return {
    sessions: new Set(known.map((row) => row.sessionHash)).size,
    sessionsTrimmed: new Set(known.filter(trimmed).map((row) => row.sessionHash)).size,
    afterTrim: tally(known.filter(trimmed)),
    otherwise: tally(known.filter((row) => !trimmed(row))),
  };
}

/** The visitor's text of a turn as `wrapVisitor` fenced it, unescaped. */
export function visitorText(message: ModelMessage): string | null {
  if (message.role !== "user" || typeof message.content !== "string") return null;
  const match = /^<visitor locale="(?:en|de)">([\s\S]*)<\/visitor>$/.exec(message.content);
  return match ? match[1]!.replaceAll("&lt;", "<").replaceAll("&gt;", ">") : null;
}

/** The visitor questions the window dropped: those of `turns` before what was kept. */
export function droppedQuestions(
  turns: readonly ModelMessage[],
  kept: readonly ModelMessage[],
): string[] {
  const dropped = turns.slice(0, turns.length - kept.length);
  return dropped.flatMap((m) => visitorText(m) ?? []);
}

/**
 * The dropped questions' most frequent content words, as the visitor wrote
 * them (the first spelling seen), most frequent first, then in order seen.
 * Only topic-shaped words count (see the top of this file).
 */
export function windowTopics(questions: readonly string[], limit = NOTE_TOPICS): string[] {
  const counts = new Map<string, { count: number; first: number; spelling: string }>();
  let seen = 0;
  for (const question of questions) {
    for (const raw of question.split(/[^\p{L}\p{N}]+/u)) {
      if (!TOPIC_WORD.test(raw)) continue;
      const word = raw.toLowerCase();
      if (FUNCTION_WORDS.has(word)) continue;
      const entry = counts.get(word);
      if (entry) entry.count++;
      else counts.set(word, { count: 1, first: seen++, spelling: raw });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, limit)
    .map((entry) => entry.spelling);
}
