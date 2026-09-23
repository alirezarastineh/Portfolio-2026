import { and, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { authAttempts } from "../db/schema.js";

/**
 * Login limiting is DB-backed rather than in-process like `rate-limit.ts`.
 * That module is fine for /contact, but an in-memory limiter resets on every
 * deploy and restart — which is exactly when an attacker would like it to.
 */
export const IP_LIMIT = 20;
/**
 * Hard limits are keyed by IP and by (IP, email), never by email alone: a
 * per-email lock lets anyone who merely knows the admin address keep the only
 * operator locked out from any number of IPs. The email bucket still feeds the
 * progressive delay, which slows a distributed run without locking anyone out.
 */
export const IP_EMAIL_LIMIT = 5;
/** Reaching the TOTP step already requires the password, so a per-user lock is safe here. */
export const TOTP_LIMIT = 5;
export const WINDOW_MS = 15 * 60 * 1000;

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export function ipBucket(ip: string): string {
  return `ip:${ip}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailBucket(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

export function ipEmailBucket(ip: string, email: string): string {
  return `ip-email:${ip}|${normalizeEmail(email)}`;
}

export function totpBucket(userId: string): string {
  return `totp:${userId}`;
}

/** Failures inside the window. Successes do not count against the limit. */
export async function recentFailures(bucket: string, windowMs = WINDOW_MS): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, bucket),
        eq(authAttempts.outcome, "fail"),
        gte(authAttempts.occurredAt, since),
      ),
    );
  return row?.count ?? 0;
}

export async function tooManyAttempts(
  bucket: string,
  limit: number,
  windowMs = WINDOW_MS,
): Promise<boolean> {
  return (await recentFailures(bucket, windowMs)) >= limit;
}

export async function recordAttempt(bucket: string, outcome: "fail" | "success"): Promise<void> {
  await getDb().insert(authAttempts).values({ bucket, outcome });
}

/** A successful login clears the email bucket so one typo cannot lock you out. */
export async function clearBucket(bucket: string): Promise<void> {
  await getDb().delete(authAttempts).where(eq(authAttempts.bucket, bucket));
}

/** Slows down a guessing run without ever blocking the event loop for long. */
export function backoffDelayMs(failures: number): number {
  return Math.min(2 ** failures * 100, 2000);
}

export async function pruneAuthAttempts(): Promise<void> {
  await getDb()
    .delete(authAttempts)
    .where(lt(authAttempts.occurredAt, new Date(Date.now() - RETENTION_MS)));
}

let pruneTimer: NodeJS.Timeout | undefined;

export function startAuthAttemptPruning(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    void pruneAuthAttempts().catch((error) =>
      console.error("[auth] pruning attempts failed", error),
    );
  }, PRUNE_INTERVAL_MS);
  // Never hold the process open just to run housekeeping.
  pruneTimer.unref?.();
}
