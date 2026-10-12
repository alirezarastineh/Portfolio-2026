import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiSkillUses } from "../../db/schema.js";
import type { SkillId } from "./skill.js";
import type { UseAggregate } from "./stats.js";

/**
 * The drafts' record (plan phase 27): a row when a skill writes a draft, and
 * the editor's verdict on it later, decided once. Ids, counts and distances;
 * never a text.
 */

/** What the editor reports: the same words, at least half of them kept in order, or neither. */
export type SkillOutcome =
  | { id: string; outcome: "kept"; pick?: number }
  | { id: string; outcome: "edited"; distance: number; pick?: number }
  | { id: string; outcome: "discarded"; distance?: number | null };

/** Words as the editor counts them (`admin/copilot-ledger.ts` `wordsOf`): split on whitespace. */
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * A draft written: its id is the suggestion id. An abstention is decided at
 * once. How it was made (plan phase 28): the repairs, the gates it still
 * fails (ids only), the candidates offered, the critic's reading. `source`:
 * the admin's copilot, or the content agent's proposals (plan phase 29).
 */
export async function recordUse(use: {
  skill: SkillId;
  version: string;
  model: string;
  text: string;
  abstained: boolean;
  repairs?: number;
  flags?: string[];
  candidates?: number;
  critic?: "ok" | "revised" | "refused" | null;
  source?: "copilot" | "agent";
}): Promise<string> {
  const [row] = await getDb()
    .insert(aiSkillUses)
    .values({
      skill: use.skill,
      version: use.version,
      source: use.source ?? "copilot",
      model: use.model,
      words: wordCount(use.text),
      repairs: use.repairs ?? 0,
      flags: use.flags ?? [],
      candidates: use.candidates ?? 1,
      critic: use.critic ?? null,
      ...(use.abstained ? { outcome: "abstained" as const, decidedAt: sql`now()` } : {}),
    })
    .returning({ id: aiSkillUses.id });
  return row!.id;
}

/** The editor's verdicts; each draft is decided once, so a repeated or unknown id is skipped. */
export async function decideUses(outcomes: readonly SkillOutcome[]): Promise<number> {
  // Each draft is decided once: the first verdict for an id wins, as it did when run in order.
  const firstPerId = [
    ...new Map(outcomes.map((verdict) => [verdict.id, verdict] as const).reverse()).values(),
  ];
  const results = await Promise.all(
    firstPerId.map((verdict) => {
      const distance = verdict.outcome === "kept" ? 0 : (verdict.distance ?? null);
      const pick = verdict.outcome === "discarded" ? null : (verdict.pick ?? null);
      return getDb()
        .update(aiSkillUses)
        .set({
          outcome: verdict.outcome,
          editDistance: distance,
          // A pick beyond the candidates offered is left out; the verdict still counts.
          pick:
            pick === null
              ? null
              : sql`case when ${pick} < ${aiSkillUses.candidates} then ${pick}::smallint end`,
          decidedAt: sql`now()`,
        })
        .where(and(eq(aiSkillUses.id, verdict.id), isNull(aiSkillUses.outcome)))
        .returning({ id: aiSkillUses.id });
    }),
  );
  return results.reduce((recorded, decided) => recorded + decided.length, 0);
}

const t = aiSkillUses;
const counted = (condition: SQL) => sql<number>`(count(*) filter (where ${condition}))::int`;
const iso = (value: unknown) =>
  value === null || value === undefined ? null : new Date(value as string | Date).toISOString();

/** The drafts per skill, version and source (the copilot's, the agents'): one grouped query. */
export async function useAggregates(): Promise<UseAggregate[]> {
  const rows = await getDb()
    .select({
      skill: t.skill,
      version: t.version,
      source: t.source,
      uses: sql<number>`count(*)::int`,
      kept: counted(sql`${t.outcome} = 'kept'`),
      edited: counted(sql`${t.outcome} = 'edited'`),
      discarded: counted(sql`${t.outcome} = 'discarded'`),
      abstained: counted(sql`${t.outcome} = 'abstained'`),
      waiting: counted(sql`${t.outcome} is null`),
      repaired: counted(sql`${t.repairs} > 0`),
      needsEye: counted(sql`jsonb_array_length(${t.flags}) > 0`),
      alternativesKept: counted(sql`${t.pick} > 0 and ${t.outcome} in ('kept', 'edited')`),
      revised: counted(sql`${t.critic} = 'revised'`),
      medianEdit: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${t.editDistance}) filter (where ${t.outcome} = 'edited')`,
      first: sql<Date>`min(${t.createdAt})`,
      last: sql<Date>`max(${t.createdAt})`,
    })
    .from(t)
    .groupBy(t.skill, t.version, t.source);
  return rows.map((row) => ({
    ...row,
    medianEdit: row.medianEdit === null ? null : Number(row.medianEdit),
    first: iso(row.first),
    last: iso(row.last),
  }));
}
