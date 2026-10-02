import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "../content/build.js";
import { getDb } from "../db/client.js";
import { aiAudit } from "../db/schema.js";
import { captureError } from "../lib/sentry.js";

/**
 * The governance log (plan phase 14). Who did or refused what, on what, why,
 * and what was considered but rejected: each demotion and reinstatement, each
 * alert, a fence stopping a run, a change to the fences, and every trust
 * check with what it looked at. The demotions in force are read from the log
 * itself, so a demotion and its audit row cannot disagree.
 */

/** Something considered and not done, and why. */
export interface AuditAlternative {
  option: string;
  why: string;
}

export interface AuditEntry {
  actor: "admin" | "agent" | "system";
  action: string;
  target: string;
  decision: "allowed" | "denied" | "asked";
  reason?: string;
  alternatives?: AuditAlternative[];
  alert?: boolean;
}

export type AuditRow = typeof aiAudit.$inferSelect;

export async function audit(entry: AuditEntry, db: DbExecutor = getDb()): Promise<AuditRow> {
  const [row] = await db
    .insert(aiAudit)
    .values({
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      decision: entry.decision,
      reason: entry.reason ?? "",
      alternatives: entry.alternatives ?? [],
      alert: entry.alert ?? false,
    })
    .returning();
  return row!;
}

/** Tells the owner outside the admin too: an alert goes to Sentry as well. */
export function notifyAlert(row: Pick<AuditRow, "action" | "target" | "reason">): void {
  captureError(new Error(`[trust] ${row.action} ${row.target}: ${row.reason}`), {
    phase: "trust-alert",
  });
}

/** An alert, written and sent. */
export async function raiseAlert(entry: Omit<AuditEntry, "alert">): Promise<AuditRow> {
  const row = await audit({ ...entry, alert: true });
  notifyAlert(row);
  return row;
}

export interface Demotion {
  subject: string;
  at: string;
  reason: string;
}

/** The demotions in force: each subject whose latest allowed demote or reinstate is a demote. */
export async function readDemotions(db: DbExecutor = getDb()): Promise<Demotion[]> {
  const latest = await db
    .selectDistinctOn([aiAudit.target], {
      target: aiAudit.target,
      action: aiAudit.action,
      at: aiAudit.at,
      reason: aiAudit.reason,
    })
    .from(aiAudit)
    .where(and(inArray(aiAudit.action, ["demote", "reinstate"]), eq(aiAudit.decision, "allowed")))
    .orderBy(aiAudit.target, desc(aiAudit.at), desc(aiAudit.id));
  return latest
    .filter((row) => row.action === "demote")
    .map((row) => ({ subject: row.target, at: row.at.toISOString(), reason: row.reason }));
}

/** When each subject was last reinstated: evidence from before then no longer counts. */
export async function lastReinstated(db: DbExecutor = getDb()): Promise<Map<string, Date>> {
  const rows = await db
    .select({ target: aiAudit.target, at: sql<Date>`max(${aiAudit.at})` })
    .from(aiAudit)
    .where(eq(aiAudit.action, "reinstate"))
    .groupBy(aiAudit.target);
  return new Map(rows.map((row) => [row.target, new Date(row.at)]));
}

const TTL_MS = 10_000;
let cache: { at: number; value: Promise<ReadonlySet<string>> } | undefined;

/** The demoted subjects, as of at most a few seconds ago (read on every visitor question). */
export function demotedSubjects(now = Date.now()): Promise<ReadonlySet<string>> {
  if (!cache || now - cache.at > TTL_MS) {
    const value = readDemotions().then((rows) => new Set(rows.map((d) => d.subject)));
    cache = { at: now, value };
    value.catch(() => {
      if (cache?.value === value) cache = undefined;
    });
  }
  return cache.value;
}

export function invalidateTrustCache(): void {
  cache = undefined;
}

/** The alerts no one has marked seen yet, newest first. */
export async function openAlerts(db: DbExecutor = getDb()): Promise<AuditRow[]> {
  return db
    .select()
    .from(aiAudit)
    .where(and(eq(aiAudit.alert, true), isNull(aiAudit.seenAt)))
    .orderBy(desc(aiAudit.at), desc(aiAudit.id))
    .limit(50);
}

/** How many alerts no one has marked seen yet, however many. */
export async function countOpenAlerts(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(aiAudit)
    .where(and(eq(aiAudit.alert, true), isNull(aiAudit.seenAt)));
  return row?.n ?? 0;
}

/** Marks an alert seen; false when there is no such alert. */
export async function markSeen(id: number): Promise<boolean> {
  const rows = await getDb()
    .update(aiAudit)
    .set({ seenAt: new Date() })
    .where(and(eq(aiAudit.id, id), eq(aiAudit.alert, true)))
    .returning({ id: aiAudit.id });
  return rows.length > 0;
}

export async function recentAudit(limit = 100): Promise<AuditRow[]> {
  return getDb().select().from(aiAudit).orderBy(desc(aiAudit.at), desc(aiAudit.id)).limit(limit);
}

/** The newest trust check, or null before the first. */
export async function lastCheck(): Promise<AuditRow | null> {
  const [row] = await getDb()
    .select()
    .from(aiAudit)
    .where(eq(aiAudit.action, "trust.check"))
    .orderBy(desc(aiAudit.at), desc(aiAudit.id))
    .limit(1);
  return row ?? null;
}
