import { fmt } from "../i18n/interpolate";
import type { AskCopy } from "./ask-copy";
import { counted } from "./receipt";

/**
 * Match a brief (visitor plan V20), the terminal's side: what `/v1/ask` takes
 * with `mode: "match"`, and the progress the server sends while it works
 * (transient parts: never part of the message, so never stored or replayed).
 * The rows themselves are the answer's text, rendered as any answer is.
 */

export const MATCH_KINDS = ["role", "project", "problem"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

/** The most a brief may be, as the server takes it (`MATCH_BRIEF_CHARS`, server/src/ask/match/prompt.ts). */
export const MATCH_BRIEF_CHARS = 4_000;

/** A brief asked for: sent with its command, and again by a retry. */
export interface MatchRequest {
  kind: MatchKind;
  brief: string;
}

export function isMatchKind(value: string): value is MatchKind {
  return (MATCH_KINDS as readonly string[]).includes(value);
}

/** The step the server says it is on (`data-match-progress`). */
export type MatchStep =
  | { step: "plan" }
  | { step: "search"; items: number }
  | { step: "write"; items: number; repair?: true }
  | { step: "check" };

/** A progress part's data, read field by field; null for anything else. */
export function matchStep(data: unknown): MatchStep | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const items =
    typeof d["items"] === "number" && Number.isInteger(d["items"]) && d["items"] >= 0
      ? d["items"]
      : null;
  switch (d["step"]) {
    case "plan":
      return { step: "plan" };
    case "check":
      return { step: "check" };
    case "search":
      return items === null ? null : { step: "search", items };
    case "write":
      if (items === null) return null;
      return d["repair"] === true
        ? { step: "write", items, repair: true }
        : { step: "write", items };
    default:
      return null;
  }
}

/** The progress line's words for a step. */
export function stepLine(step: MatchStep, copy: AskCopy["match"]["steps"]): string {
  switch (step.step) {
    case "plan":
      return copy.plan;
    case "search":
      return counted(step.items, copy.search);
    case "write":
      return step.repair ? copy.repair : copy.write;
    case "check":
      return copy.check;
  }
}

/** The paste box's counter: `{n}` of `{max}` characters, in the reader's numbers. */
export function counterLine(length: number, copy: AskCopy["match"], locale: string): string {
  const number = new Intl.NumberFormat(locale);
  return fmt(copy.counter, { n: number.format(length), max: number.format(MATCH_BRIEF_CHARS) });
}
