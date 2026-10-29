import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiMessages } from "../db/schema.js";
import { MATCH_ROUTE } from "./outcome-rows.js";

/**
 * `forget` (visitor plan V14): a visitor deletes what the log keeps of their
 * tab's conversation, by the salted hashes of its session ids (the current
 * one, and those before the tab's `reset`s). One transaction:
 * first the insights runs' quotes of the session's questions and its briefs'
 * items (a topic keeps up to three verbatim), matched while those questions are still there, then
 * the session's answers, and with them, by cascade, their feedback and its
 * reason and their reviews; the browser's signals are a column of the answer.
 *
 * Kept: an eval case frozen from one of them, its link set null (its question
 * was rewritten and confirmed free of anything personal before it was kept);
 * a contact message the visitor sent, with the conversation they attached
 * (they sent it to a person); journal entries, whose ids no longer resolve.
 * Corpus snapshots go with the next prune, once nothing refers to them.
 */

/** How long an answer still being written for a forgotten session is kept out of the log. */
const FORGOTTEN_MS = 15 * 60 * 1000;
const MAX_FORGOTTEN = 10_000;
const forgotten = new Map<string, number>();

/** Whether this session was forgotten moments ago: an answer finishing for it is not logged. */
export function wasForgotten(sessionHash: string, now = Date.now()): boolean {
  return (forgotten.get(sessionHash) ?? 0) > now;
}

/** Held in memory only, a quarter of an hour: expired entries go first, then the oldest. */
function remember(sessionHash: string, now: number): void {
  for (const [hash, until] of forgotten) if (until <= now) forgotten.delete(hash);
  const oldest = forgotten.keys().next();
  if (forgotten.size >= MAX_FORGOTTEN && !oldest.done) forgotten.delete(oldest.value);
  forgotten.set(sessionHash, now + FORGOTTEN_MS);
}

/** For tests: nothing remembered. */
export function resetForgotten(): void {
  forgotten.clear();
}

/**
 * How many answers were deleted; 0 for sessions the log does not know. The
 * tab's current session and those before its `reset`s, all the visitor's.
 */
export async function forgetSessions(
  sessionHashes: readonly string[],
  now = Date.now(),
): Promise<number> {
  const hashes = [...new Set(sessionHashes)];
  if (!hashes.length) return 0;
  for (const hash of hashes) remember(hash, now);
  const sessions = sql.join(
    hashes.map((hash) => sql`${hash}`),
    sql`, `,
  );
  return getDb().transaction(async (tx) => {
    // A quote may differ from the question in case and spacing only: both are compared so.
    // A match's items join the questions (visitor plan V20): insights read them as questions.
    await tx.execute(sql`
      with gone as (
        select array_agg(distinct lower(regexp_replace(btrim(q), '\\s+', ' ', 'g'))) as quotes
        from (
          select question_redacted as q
          from ai_messages
          where session_hash in (${sessions}) and source = 'terminal'
          union all
          select i ->> 'text'
          from ai_messages m
          cross join lateral jsonb_array_elements(coalesce(m.trace -> 'match' -> 'items', '[]'::jsonb)) as i
          where m.session_hash in (${sessions}) and m.source = 'terminal' and m.route = ${MATCH_ROUTE}
            and i ->> 'text' is not null
        ) as asked
      )
      update ai_insight_snapshots s
      set topics = (
        select coalesce(jsonb_agg(
          case when jsonb_typeof(t.value -> 'examples') = 'array'
            then jsonb_set(t.value, '{examples}', coalesce((
              select jsonb_agg(e.value order by e.ord)
              from jsonb_array_elements(t.value -> 'examples') with ordinality as e(value, ord)
              where not (lower(regexp_replace(btrim(e.value #>> '{}'), '\\s+', ' ', 'g')) = any(gone.quotes))
            ), '[]'::jsonb))
            else t.value
          end
          order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(s.topics) with ordinality as t(value, ord)
      )
      from gone
      where gone.quotes is not null
        and exists (
          select 1
          from jsonb_array_elements(s.topics) as t2(value),
            jsonb_array_elements(case when jsonb_typeof(t2.value -> 'examples') = 'array'
              then t2.value -> 'examples' else '[]'::jsonb end) as e2(value)
          where lower(regexp_replace(btrim(e2.value #>> '{}'), '\\s+', ' ', 'g')) = any(gone.quotes)
        )`);
    const deleted = await tx
      .delete(aiMessages)
      .where(and(inArray(aiMessages.sessionHash, hashes), eq(aiMessages.source, "terminal")))
      .returning({ id: aiMessages.id });
    return deleted.length;
  });
}
