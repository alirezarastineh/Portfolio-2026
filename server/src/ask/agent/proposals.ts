import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiProposals, type ProposalStatus } from "../../db/schema.js";

/**
 * The content agent's proposals (plan phase 29), one per target and run: a
 * draft for a gap, never written to the content. Phase 30 decides them.
 */

export type Proposal = typeof aiProposals.$inferSelect;
export type NewProposal = typeof aiProposals.$inferInsert;

export const PROPOSAL_STATUSES = [
  "proposed",
  "needs_you",
  "accepted",
  "rejected",
  "applied",
  "reverted",
  "stale",
] as const satisfies readonly ProposalStatus[];

type TargetOf = Pick<NewProposal, "goal" | "kind" | "entityId" | "field" | "locale">;

/** A run's proposal for a target, if it has one: drafted before a cancel or a restart cut its item off. */
export async function proposalFor(
  runId: string,
  target: TargetOf,
): Promise<{ id: string; status: ProposalStatus } | null> {
  const [row] = await getDb()
    .select({ id: aiProposals.id, status: aiProposals.status })
    .from(aiProposals)
    .where(
      and(
        eq(aiProposals.runId, runId),
        eq(aiProposals.goal, target.goal),
        eq(aiProposals.kind, target.kind),
        eq(aiProposals.entityId, target.entityId),
        eq(aiProposals.field, target.field),
        eq(aiProposals.locale, target.locale),
      ),
    );
  return row ?? null;
}

/**
 * A run's proposal for a target, and its id. One already there is kept as it
 * was: a target is drafted once a run.
 */
export async function insertProposal(proposal: NewProposal & { runId: string }): Promise<string> {
  const [row] = await getDb()
    .insert(aiProposals)
    .values(proposal)
    .onConflictDoNothing()
    .returning({ id: aiProposals.id });
  return row?.id ?? (await proposalFor(proposal.runId, proposal))!.id;
}

/** The proposals, newest first, of a run or in one of some statuses. */
export async function listProposals(
  filter: { runId?: string; statuses?: readonly ProposalStatus[] },
  limit = 200,
): Promise<Proposal[]> {
  const where: SQL[] = [];
  if (filter.runId) where.push(eq(aiProposals.runId, filter.runId));
  if (filter.statuses?.length) where.push(inArray(aiProposals.status, [...filter.statuses]));
  return getDb()
    .select()
    .from(aiProposals)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(aiProposals.createdAt), desc(aiProposals.id))
    .limit(limit);
}
