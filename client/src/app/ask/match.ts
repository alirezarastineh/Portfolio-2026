import { fmt } from "../i18n/interpolate";
import type { AskCopy } from "./ask-copy";
import type { AskMessage } from "./ask-types";
import type { LinkKind } from "./link-policy";
import { counted } from "./receipt";

/**
 * Match a brief (visitor plan V20), the terminal's side: what `/v1/ask` takes
 * with `mode: "match"`, and the progress the server sends while it works
 * (transient parts: never part of the message, so never stored or replayed).
 * The rows are the answer's text, rendered as any answer is, and again as
 * data for the match page (`data-match`, plan 3 W2).
 */

export const MATCH_KINDS = ["role", "project", "problem"] as const;
export type MatchKind = (typeof MATCH_KINDS)[number];

const MATCH_STATUSES = ["evidence", "partial", "not-published"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** One row of a match, in the server's words (`data-match`, plan 3 W2). */
export interface MatchRow {
  n: number;
  text: string;
  /** Empty outside a role. */
  priorityLabel: string;
  status: MatchStatus;
  statusLabel: string;
  summary: string;
  cites: { id: string; title: string; url: string }[];
}

/**
 * A match's rows from its answer's `data-match` part, read field by field;
 * null when it has none, or a malformed one. A cite's page must be the site's
 * own where a browser opens it (`linkPolicyFor`): "/\evil.example" is not.
 */
export function matchData(
  message: Pick<AskMessage, "parts"> | undefined,
  link: (href: string) => LinkKind | null,
): { kind: MatchKind; items: MatchRow[] } | null {
  const part = message?.parts.find((p) => p.type === "data-match") as
    { data?: Record<string, unknown> } | undefined;
  const data = part?.data;
  const kind = data?.["kind"];
  if (data?.["v"] !== 1 || typeof kind !== "string" || !isMatchKind(kind)) return null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const objects = (value: unknown) =>
    (Array.isArray(value) ? value : []).map(
      (raw: unknown) => (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>,
    );
  const items = objects(data["items"]).flatMap((r): MatchRow[] => {
    const { n, status } = r;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return [];
    if (!(MATCH_STATUSES as readonly unknown[]).includes(status)) return [];
    const text = str(r["text"]);
    const statusLabel = str(r["statusLabel"]);
    if (!text || !statusLabel) return [];
    const cites = objects(r["cites"]).flatMap((c) => {
      const cite = { id: str(c["id"]), title: str(c["title"]), url: str(c["url"]) };
      return cite.id && cite.title && link(cite.url) === "internal" ? [cite] : [];
    });
    return [
      {
        n,
        text,
        priorityLabel: str(r["priorityLabel"]),
        status: status as MatchStatus,
        statusLabel,
        summary: str(r["summary"]),
        cites,
      },
    ];
  });
  return items.length ? { kind, items } : null;
}

/** Which mark a row carries: its status, or "ask" on a careful topic (a budget, a rate, pay). */
export type MatchMark = MatchStatus | "ask";

/** The server's line for a careful topic (`LINES.careful`, in `PROMPT_HASH`): the row says ask him. */
const ASK_HIM = new Set(["ask him directly.", "frag ihn direkt."]);

export function markOf(row: Pick<MatchRow, "status" | "summary">): MatchMark {
  return row.status === "not-published" && ASK_HIM.has(row.summary) ? "ask" : row.status;
}

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
export function counterLine(
  length: number,
  copy: AskCopy["match"],
  locale: string,
  max = MATCH_BRIEF_CHARS,
): string {
  const number = new Intl.NumberFormat(locale);
  return fmt(copy.counter, { n: number.format(length), max: number.format(max) });
}
