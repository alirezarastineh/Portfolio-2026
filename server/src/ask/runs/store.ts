import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiRunItems, aiRuns } from "../../db/schema.js";
import { pgErrorCode } from "../../lib/http-errors.js";

/**
 * Runs and their items in the database: the checkpoint a background run
 * resumes from. Every item is written as it finishes, so a closed tab, a
 * restart or a cancel loses at most the item in flight.
 */

export const RUN_KINDS = ["eval", "pairwise", "judge", "insights", "agent"] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";
export type ItemStatus = "pending" | "running" | "done" | "failed" | "unavailable";

export interface RunProgress {
  total: number;
  done: number;
  failed: number;
  unavailable: number;
}

export type RunRow = typeof aiRuns.$inferSelect;
export type ItemRow = typeof aiRunItems.$inferSelect;

/** A new running run with its items, or null when one of this kind is already active. */
export async function createRun(
  kind: RunKind,
  params: Record<string, unknown>,
  keys: string[],
): Promise<RunRow | null> {
  try {
    return await getDb().transaction(async (tx) => {
      const now = new Date();
      const [run] = await tx
        .insert(aiRuns)
        .values({
          kind,
          status: "running",
          params,
          progress: { total: keys.length, done: 0, failed: 0, unavailable: 0 },
          startedAt: now,
          heartbeatAt: now,
        })
        .returning();
      if (keys.length) {
        await tx
          .insert(aiRunItems)
          .values(keys.map((key, position) => ({ runId: run!.id, key, position })));
      }
      return run!;
    });
  } catch (error) {
    // The partial unique index: one queued or running run per kind.
    if (pgErrorCode(error) === "23505") return null;
    throw error;
  }
}

/** Puts a stopped run back to running, or null when it is not resumable or its kind is busy. */
export async function reopenRun(id: string): Promise<RunRow | null> {
  try {
    const [run] = await getDb()
      .update(aiRuns)
      .set({ status: "running", error: null, finishedAt: null, heartbeatAt: new Date() })
      .where(and(eq(aiRuns.id, id), inArray(aiRuns.status, ["interrupted", "failed", "cancelled"])))
      .returning();
    return run ?? null;
  } catch (error) {
    if (pgErrorCode(error) === "23505") return null;
    throw error;
  }
}

/** Keys still to do, in their original order. */
export async function unfinishedKeys(runId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ key: aiRunItems.key })
    .from(aiRunItems)
    .where(
      and(
        eq(aiRunItems.runId, runId),
        inArray(aiRunItems.status, ["pending", "running", "unavailable"]),
      ),
    )
    .orderBy(asc(aiRunItems.position));
  return rows.map((r) => r.key);
}

export async function startItem(runId: string, key: string): Promise<void> {
  await getDb()
    .update(aiRunItems)
    .set({ status: "running", attempts: sql`${aiRunItems.attempts} + 1`, updatedAt: new Date() })
    .where(and(eq(aiRunItems.runId, runId), eq(aiRunItems.key, key)));
}

/** One item's outcome, then the run's counters, cost and heartbeat. */
export async function finishItem(
  runId: string,
  key: string,
  outcome: { status: ItemStatus; result?: unknown; usd?: number },
): Promise<void> {
  const db = getDb();
  await db
    .update(aiRunItems)
    .set({
      status: outcome.status,
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
      usd: sql`${aiRunItems.usd} + ${outcome.usd ?? 0}`,
      updatedAt: new Date(),
    })
    .where(and(eq(aiRunItems.runId, runId), eq(aiRunItems.key, key)));
  await refreshProgress(runId);
}

export async function refreshProgress(runId: string): Promise<void> {
  await getDb().execute(sql`
    update ai_runs r set
      progress = jsonb_build_object(
        'total', c.total, 'done', c.done, 'failed', c.failed, 'unavailable', c.unavailable),
      usd = c.usd,
      heartbeat_at = now()
    from (
      select count(*)::int as total,
        count(*) filter (where status = 'done')::int as done,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'unavailable')::int as unavailable,
        coalesce(sum(usd), 0)::float8 as usd
      from ai_run_items where run_id = ${runId}
    ) c
    where r.id = ${runId}`);
}

export async function endRun(
  runId: string,
  status: Exclude<RunStatus, "queued" | "running">,
  extra: { summary?: unknown; error?: string | null } = {},
): Promise<void> {
  await getDb().transaction(async (tx) => {
    // An item cut off mid-way is simply still to do.
    await tx
      .update(aiRunItems)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(eq(aiRunItems.runId, runId), eq(aiRunItems.status, "running")));
    await tx
      .update(aiRuns)
      .set({
        status,
        finishedAt: new Date(),
        ...(extra.summary === undefined ? {} : { summary: extra.summary }),
        error: extra.error ?? null,
      })
      .where(eq(aiRuns.id, runId));
  });
  await refreshProgress(runId);
}

export async function listRuns(limit = 20): Promise<RunRow[]> {
  return getDb().select().from(aiRuns).orderBy(desc(aiRuns.createdAt)).limit(limit);
}

export async function getRun(id: string): Promise<{ run: RunRow; items: ItemRow[] } | null> {
  const [run] = await getDb().select().from(aiRuns).where(eq(aiRuns.id, id));
  if (!run) return null;
  const items = await getDb()
    .select()
    .from(aiRunItems)
    .where(eq(aiRunItems.runId, id))
    .orderBy(asc(aiRunItems.position));
  return { run, items };
}

export async function activeRuns(): Promise<RunRow[]> {
  return getDb()
    .select()
    .from(aiRuns)
    .where(inArray(aiRuns.status, ["queued", "running"]));
}
