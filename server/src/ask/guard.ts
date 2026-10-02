import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiRateEvents, aiUsage, aiUsageFeatures } from "../db/schema.js";
import type { AskConfig } from "./config.js";
import { isSwitched, reserveLine, type Feature } from "./features.js";
import type { AiSettings } from "./settings.js";

/**
 * What stands between a visitor and a paid model call, cheapest check first:
 * the kill switches, the daily budget, the per-visitor rate limits (in the
 * database, so a restart does not reset them) and a cap on simultaneous
 * streams. The same budget fences everything else that spends (plan phase
 * 13): the admin's tools and background runs stop short of a reserve kept for
 * visitors, and at their own caps.
 */

/** Which line a resting feature reached: the whole budget, the visitors' reserve, its own cap. */
export type SpendLine = "budget" | "reserve" | "cap";

export type Availability =
  | { state: "ok"; deepAllowed: boolean; spentUsd: number; budgetUsd: number }
  | { state: "off"; reason: string }
  | { state: "resting"; spentUsd: number; budgetUsd: number; line: SpendLine };

/** Today's spend: the day's total, and the asking feature's own share of it. */
export interface Spend {
  totalUsd: number;
  ownUsd: number;
}

/** At this share of the budget the deep model is switched off for the day. */
export const DEEP_CUTOFF = 0.8;

export function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

const dayTotal = (day: string) =>
  getDb()
    .select({ usd: sql<number>`coalesce(sum(${aiUsage.usd}), 0)::float8` })
    .from(aiUsage)
    .where(eq(aiUsage.day, day));

/**
 * Today's spend for `feature`. The total comes from `ai_usage`, which every
 * writer fills (an API from before this phase too, earlier on a deploy day).
 * The terminal never needs its own share, so its hot path stays one query.
 */
export async function spendToday(feature: Feature, at = new Date()): Promise<Spend> {
  const day = utcDay(at);
  if (feature === "terminal") return { totalUsd: (await dayTotal(day))[0]?.usd ?? 0, ownUsd: 0 };
  const [[total], [own]] = await Promise.all([
    dayTotal(day),
    getDb()
      .select({ usd: sql<number>`coalesce(sum(${aiUsageFeatures.usd}), 0)::float8` })
      .from(aiUsageFeatures)
      .where(and(eq(aiUsageFeatures.day, day), eq(aiUsageFeatures.feature, feature))),
  ]);
  return { totalUsd: total?.usd ?? 0, ownUsd: own?.usd ?? 0 };
}

/** Today's spend split by feature, for the Overview. */
export async function spendByFeature(
  at = new Date(),
): Promise<{ totalUsd: number; features: Map<string, number> }> {
  const day = utcDay(at);
  const [[total], rows] = await Promise.all([
    dayTotal(day),
    getDb()
      .select({
        feature: aiUsageFeatures.feature,
        usd: sql<number>`sum(${aiUsageFeatures.usd})::float8`,
      })
      .from(aiUsageFeatures)
      .where(eq(aiUsageFeatures.day, day))
      .groupBy(aiUsageFeatures.feature),
  ]);
  return {
    totalUsd: total?.usd ?? 0,
    features: new Map(rows.map((row) => [row.feature, row.usd])),
  };
}

/** Why `feature` is off, whatever the spend; null when its switches are on. */
function offReason(config: AskConfig, settings: AiSettings, feature: Feature): string | null {
  if (!config.enabled) return "disabled";
  if (config.unavailableReason) return "unconfigured";
  // The admin's switch closes the visitors' terminal, not the admin's own tools.
  if (feature === "terminal") return settings.enabled ? null : "disabled_by_admin";
  if (isSwitched(feature) && !settings.featureSwitches[feature]) return "switched_off";
  return null;
}

/**
 * The state of `feature` for a given spend today: pure, so it holds for every
 * spend (see the property tests). The terminal rests only once the whole
 * budget is spent. Every other feature stops earlier: once the day's total
 * reaches the line that keeps the visitors' reserve, or once its own spend
 * reaches its cap. Whatever the rest spends, visitors keep that share.
 */
export function stateFor(
  config: AskConfig,
  settings: AiSettings,
  feature: Feature,
  spend: Spend,
): Availability {
  const reason = offReason(config, settings, feature);
  if (reason) return { state: "off", reason };
  const budgetUsd = settings.dailyBudgetUsd ?? config.dailyBudgetUsd;
  const spentUsd = spend.totalUsd;
  const resting = (line: SpendLine): Availability => ({
    state: "resting",
    spentUsd,
    budgetUsd,
    line,
  });
  if (spentUsd >= budgetUsd) return resting("budget");
  if (feature !== "terminal") {
    if (spentUsd >= reserveLine(budgetUsd, settings.publicReserve)) return resting("reserve");
    const cap = settings.featureCaps[feature];
    if (cap !== null && spend.ownUsd >= cap) return resting("cap");
  }
  return {
    state: "ok",
    deepAllowed: settings.deepEnabled && spentUsd < budgetUsd * DEEP_CUTOFF,
    spentUsd,
    budgetUsd,
  };
}

export async function availability(
  config: AskConfig,
  settings: AiSettings,
  feature: Feature,
): Promise<Availability> {
  // Off needs no database: the spend is read only when it can matter.
  if (offReason(config, settings, feature)) {
    return stateFor(config, settings, feature, { totalUsd: 0, ownUsd: 0 });
  }
  return stateFor(config, settings, feature, await spendToday(feature));
}

const REFUSALS: Record<SpendLine, string> = {
  budget: "assistant_resting",
  reserve: "reserve_reached",
  cap: "cap_reached",
};

/** The error an API answers with when a feature may not spend now. */
export function refusal(state: Exclude<Availability, { state: "ok" }>): string {
  if (state.state === "off") {
    return state.reason === "switched_off" ? "feature_off" : "assistant_off";
  }
  return REFUSALS[state.line];
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
  const waits = await Promise.all(windows.map((window) => overLimit(window, now)));
  const retryAfter = Math.max(0, ...waits.filter((wait): wait is number => wait !== null));
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
