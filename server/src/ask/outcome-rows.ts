import { and, eq, notInArray, sql } from "drizzle-orm";

import { aiFeedback, aiMessages } from "../db/schema.js";
import { NOT_IN_PORTFOLIO } from "./answer-patterns.js";

/** The route a guided tour is logged under (visitor plan V16): a visitor's row, but no answer. */
export const TOUR_ROUTE = "tour";

/** The route a matched brief is logged under (visitor plan V19): a visitor's row, but no answer. */
export const MATCH_ROUTE = "match";

/**
 * A visitor's answers: the terminal's rows less their tours (visitor plan
 * V16) and matched briefs (V19), which every measure of answers leaves out.
 * `forget`, `inspect`, the browser's signals and the contact form's attached
 * conversation reach them all.
 */
export const VISITOR_ANSWER = and(
  eq(aiMessages.source, "terminal"),
  notInArray(aiMessages.route, [TOUR_ROUTE, MATCH_ROUTE]),
)!;

/**
 * Answers that admit the portfolio does not say: the list worth turning into
 * FAQ entries. The same pattern the eval graders use (answer-patterns.ts).
 */
export const UNKNOWN_ANSWER = sql`(${aiMessages.answerExcerpt} ~* ${NOT_IN_PORTFOLIO})`;

/**
 * An answer that offered the hand-off: the model called the tool, or the
 * server made the offer itself (visitor plan V6), which the trace records.
 */
export const OFFERED_HANDOFF = sql`(${aiMessages.toolCalls} @> '["handoff_contact"]'::jsonb or ${aiMessages.trace} -> 'handoff' is not null)`;

/**
 * An answer as outcomes.ts reads it (`OutcomeRow`), for the outcomes and the
 * perception routes; the select needs the left join on `ai_feedback`.
 */
export const OUTCOME_COLUMNS = {
  id: aiMessages.id,
  sessionHash: aiMessages.sessionHash,
  createdAt: aiMessages.createdAt,
  question: aiMessages.questionRedacted,
  finishReason: aiMessages.finishReason,
  usd: aiMessages.usd,
  flags: sql<string[]>`coalesce(${aiMessages.checks} -> 'flags', '[]'::jsonb)`,
  feedback: sql<1 | -1 | null>`${aiFeedback.value}`,
  faithfulness: sql<number | null>`(${aiMessages.judge} ->> 'faithfulness')::float8`,
  unknown: sql<boolean>`${UNKNOWN_ANSWER}`,
  handoffOffered: sql<boolean>`${OFFERED_HANDOFF}`,
  handoffConfirmed: sql<boolean>`${aiMessages.handoffConfirmedAt} is not null`,
  // What the visitor's browser saw, and why a 👎 (visitor plan V2).
  downReason: sql<string | null>`${aiFeedback.reason}`,
  signals: aiMessages.signals,
  ttftMs: aiMessages.ttftMs,
  followupsOffered: sql<boolean>`${aiMessages.toolCalls} @> '["suggest_followups"]'::jsonb`,
  cited: sql<boolean>`jsonb_array_length(${aiMessages.citedIds}) > 0`,
};
