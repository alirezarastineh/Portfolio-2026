import { sql } from "drizzle-orm";

import { aiFeedback, aiMessages } from "../db/schema.js";
import { NOT_IN_PORTFOLIO } from "./answer-patterns.js";

/**
 * Answers that admit the portfolio does not say: the list worth turning into
 * FAQ entries. The same pattern the eval graders use (answer-patterns.ts).
 */
export const UNKNOWN_ANSWER = sql`(${aiMessages.answerExcerpt} ~* ${NOT_IN_PORTFOLIO})`;

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
  handoffOffered: sql<boolean>`${aiMessages.toolCalls} @> '["handoff_contact"]'::jsonb`,
  handoffConfirmed: sql<boolean>`${aiMessages.handoffConfirmedAt} is not null`,
};
