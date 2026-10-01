import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiGuardEvents } from "../db/schema.js";
import { utcDay } from "./guard.js";

/**
 * The requests the public assistant turned away, counted per UTC day and
 * kind: what the gate refused, which the answers table never sees. Counts
 * gather in memory and are written once a minute, so a flood of bad requests
 * costs one upsert per kind, not one write per request. A crash loses at most
 * a minute of counts.
 */

export const GUARD_EVENT_KINDS = [
  "invalid_input",
  "honeypot",
  "too_large",
  "too_long",
  "turnstile_required",
  "off",
  "resting",
  "rate_limited",
  "busy",
] as const;

export type GuardEventKind = (typeof GUARD_EVENT_KINDS)[number];

export interface GuardEventRow {
  day: string;
  kind: GuardEventKind;
  count: number;
}

const pending = new Map<string, GuardEventRow>();

export function countGuardEvent(kind: GuardEventKind, at = new Date()): void {
  const day = utcDay(at);
  const key = `${day}|${kind}`;
  const row = pending.get(key);
  if (row) row.count++;
  else pending.set(key, { day, kind, count: 1 });
}

async function upsert(rows: GuardEventRow[]): Promise<void> {
  await getDb()
    .insert(aiGuardEvents)
    .values(rows)
    .onConflictDoUpdate({
      target: [aiGuardEvents.day, aiGuardEvents.kind],
      set: { count: sql`${aiGuardEvents.count} + excluded.count` },
    });
}

/** Writes what has gathered. Counts that fail to write are kept for the next flush. */
export async function flushGuardEvents(write = upsert): Promise<void> {
  if (!pending.size) return;
  const rows = [...pending.values()];
  pending.clear();
  try {
    await write(rows);
  } catch (error) {
    for (const row of rows) {
      const key = `${row.day}|${row.kind}`;
      const since = pending.get(key);
      pending.set(key, { ...row, count: row.count + (since?.count ?? 0) });
    }
    throw error;
  }
}

/** Counted but not yet written (for tests and the shutdown log). */
export function pendingGuardEvents(): GuardEventRow[] {
  return [...pending.values()].map((row) => ({ ...row }));
}

let timer: NodeJS.Timeout | undefined;

export function startGuardEventFlush(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void flushGuardEvents().catch((error: unknown) =>
      console.error("[ask] guard events not written", error),
    );
  }, intervalMs);
  timer.unref?.();
}
