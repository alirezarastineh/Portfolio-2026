import { sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiFaqProposals } from "../../db/schema.js";
import { decideUse } from "./verdicts.js";

/**
 * Open FAQ proposals go with the visitor text they were drafted from (plan
 * phase 31): their drafts paraphrase visitors' questions, so none outlives
 * them. An insight topic's goes once its run is pruned (59 days after it ran,
 * just before this, in the same nightly tick). A journal entry's goes once
 * the entry's answer is gone or 89 days old (a day ahead of the answers' 90,
 * this prune being nightly), or the entry was deleted. A decided proposal
 * keeps no text and stays: it is the FAQ entry's provenance. The drafts of
 * one that goes were never decided: discarded, as the editors' ledger
 * discards a draft left behind.
 */

const ANSWER_DAYS = 89;

/** Prunes the open proposals whose source is gone; how many went. */
export async function pruneFaqProposals(): Promise<number> {
  const { rows } = await getDb().execute<{ uses: Record<string, string> }>(sql`
    delete from ${aiFaqProposals} as p
    where p.status in ('proposed', 'needs_you')
      and (
        (p.source = 'insight' and p.snapshot_id is null)
        or (p.source = 'journal' and not exists (
          select 1 from ai_journal as j
            join ai_messages as m on m.id = j.message_ids ->> 0
          where j.id = p.journal_id
            and m.created_at >= now() - make_interval(days => ${ANSWER_DAYS})
        ))
      )
    returning p.uses`);
  await Promise.all(
    rows
      .flatMap((row) => Object.values(row.uses))
      .map((id) => decideUse(id, { outcome: "discarded", distance: null })),
  );
  return rows.length;
}
