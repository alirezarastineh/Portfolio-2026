import type { ToolName } from "./tools.js";
import type { AnswerTrace } from "./trace.js";

/**
 * The answer's receipt (visitor plan V12): what it did, as counts and codes,
 * sent with its finish for the terminal's receipt line and the hero's trace
 * panel. No text of any kind: no question, no title, no instruction, no
 * model's words. Built field by field below, so nothing joins it unlisted
 * (`RECEIPT_FIELDS`, receipt.spec.ts).
 */
export interface AnswerReceipt {
  /** The lookups the model made: searches, fetches, the project list, the CV. */
  lookups: number;
  /** The documents it cited, each checked against the published corpus. */
  sources: number;
  /** References to documents that do not exist, removed before the visitor saw them. */
  removed: number;
  /** Why it moved from the fast to the thorough model mid-way. */
  escalation?: NonNullable<AnswerTrace["escalation"]>["reason"];
  /** The careful topic it kept to published facts on. */
  careful?: NonNullable<NonNullable<AnswerTrace["routing"]>["sensitive"]>;
  /** The case study or post it was asked on, by document id. */
  page?: string;
  /** What the visitor pointed at on that page, and whether the page holds it. */
  focus?: NonNullable<AnswerTrace["focus"]>;
  /** The level the visitor chose, when not standard. */
  level?: NonNullable<AnswerTrace["level"]>;
  /** Why the verifier repaired an answer without words, and who wrote them. */
  repair?: NonNullable<AnswerTrace["repair"]>;
}

/** Every field the receipt may carry; a new one is added here and in its test first. */
export const RECEIPT_FIELDS = [
  "lookups",
  "sources",
  "removed",
  "escalation",
  "careful",
  "page",
  "focus",
  "level",
  "repair",
] as const satisfies readonly (keyof AnswerReceipt)[];

/** The tools that look something up; the others act (navigate, follow-ups, the hand-off). */
const LOOKUPS: ReadonlySet<string> = new Set<ToolName>([
  "search_portfolio",
  "get_document",
  "list_projects",
  "get_resume",
]);

export function answerReceipt(
  trace: Pick<AnswerTrace, "routing" | "escalation" | "page" | "focus" | "level" | "repair">,
  counts: { toolNames: readonly string[]; cited: number; dropped: readonly string[] },
): AnswerReceipt {
  return {
    lookups: counts.toolNames.filter((name) => LOOKUPS.has(name)).length,
    sources: counts.cited,
    // Each invented id once, as the log keeps them.
    removed: new Set(counts.dropped).size,
    ...(trace.escalation ? { escalation: trace.escalation.reason } : {}),
    ...(trace.routing?.sensitive ? { careful: trace.routing.sensitive } : {}),
    ...(trace.page ? { page: trace.page.id } : {}),
    ...(trace.focus ? { focus: { kind: trace.focus.kind, verified: trace.focus.verified } } : {}),
    ...(trace.level ? { level: trace.level } : {}),
    ...(trace.repair ? { repair: { reason: trace.repair.reason, by: trace.repair.by } } : {}),
  };
}
