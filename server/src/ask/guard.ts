import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiRateEvents, aiUsage } from "../db/schema.js";
import type { AskConfig } from "./config.js";
import type { AiSettings } from "./settings.js";

/**
 * What stands between a visitor and a paid model call, cheapest check first:
 * the kill switches, the daily budget, the per-visitor rate limits (in the
 * database, so a restart does not reset them) and a cap on simultaneous
 * streams.
 */

export type Availability =
  | { state: "ok"; deepAllowed: boolean; spentUsd: number; budgetUsd: number }
  | { state: "off"; reason: string }
  | { state: "resting"; spentUsd: number; budgetUsd: number };

/** At this share of the budget the deep model is switched off for the day. */
export const DEEP_CUTOFF = 0.8;

export function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export async function spentToday(at = new Date()): Promise<number> {
  const [row] = await getDb()
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.usd}), 0)::float8` })
    .from(aiUsage)
    .where(eq(aiUsage.day, utcDay(at)));
  return row?.usd ?? 0;
}

export async function availability(config: AskConfig, settings: AiSettings): Promise<Availability> {
  if (!config.enabled) return { state: "off", reason: "disabled" };
  if (config.unavailableReason) return { state: "off", reason: "unconfigured" };
  if (!settings.enabled) return { state: "off", reason: "disabled_by_admin" };
  const budgetUsd = settings.dailyBudgetUsd ?? config.dailyBudgetUsd;
  const spentUsd = await spentToday();
  if (spentUsd >= budgetUsd) return { state: "resting", spentUsd, budgetUsd };
  return {
    state: "ok",
    deepAllowed: settings.deepEnabled && spentUsd < budgetUsd * DEEP_CUTOFF,
    spentUsd,
    budgetUsd,
  };
}

/**
 * A salted hash, like the contact form's: enough to count, not to identify.
 * Without IP_HASH_SALT the salt lives only as long as the process.
 */
const processSalt = randomBytes(16).toString("hex");
export function hashWithSalt(kind: "ip" | "session", value: string): string {
  const salt = process.env.IP_HASH_SALT?.trim() || processSalt;
  return createHash("sha256").update(`${salt}:${kind}:${value}`).digest("hex");
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface Window {
  bucket: string;
  limit: number;
  windowMs: number;
}

/** Seconds until the oldest counted event leaves the window; null when under the limit. */
async function overLimit({ bucket, limit, windowMs }: Window, now: number): Promise<number | null> {
  const since = new Date(now - windowMs);
  const [count] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(aiRateEvents)
    .where(and(eq(aiRateEvents.bucket, bucket), gte(aiRateEvents.occurredAt, since)));
  if ((count?.n ?? 0) < limit) return null;
  const [oldest] = await getDb()
    .select({ at: aiRateEvents.occurredAt })
    .from(aiRateEvents)
    .where(and(eq(aiRateEvents.bucket, bucket), gte(aiRateEvents.occurredAt, since)))
    .orderBy(asc(aiRateEvents.occurredAt))
    .limit(1);
  const freesAt = (oldest?.at.getTime() ?? now) + windowMs;
  return Math.max(1, Math.ceil((freesAt - now) / 1000));
}

export async function checkRate(
  config: AskConfig,
  ipHash: string,
  sessionHash: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfter: number }> {
  const windows: Window[] = [
    { bucket: `ip:${ipHash}`, limit: config.ratePerHour, windowMs: HOUR_MS },
    { bucket: `ip:${ipHash}`, limit: config.ratePerDay, windowMs: DAY_MS },
    { bucket: `session:${sessionHash}`, limit: config.sessionRatePerHour, windowMs: HOUR_MS },
  ];
  let retryAfter = 0;
  for (const window of windows) {
    const wait = await overLimit(window, now);
    if (wait !== null) retryAfter = Math.max(retryAfter, wait);
  }
  return retryAfter ? { ok: false, retryAfter } : { ok: true };
}

export async function recordRequest(ipHash: string, sessionHash: string): Promise<void> {
  await getDb()
    .insert(aiRateEvents)
    .values([{ bucket: `ip:${ipHash}` }, { bucket: `session:${sessionHash}` }]);
}

export async function pruneRateEvents(now = Date.now()): Promise<void> {
  await getDb()
    .delete(aiRateEvents)
    .where(lt(aiRateEvents.occurredAt, new Date(now - DAY_MS - HOUR_MS)));
}

/** Streams in flight. A fast 429 beyond the cap keeps a burst from starving the API. */
export class ConcurrencyGate {
  private active = 0;

  constructor(private readonly limit: () => number) {}

  get inFlight(): number {
    return this.active;
  }

  /** A release function, or null when full. Releasing twice is harmless. */
  tryEnter(): (() => void) | null {
    if (this.active >= this.limit()) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}
