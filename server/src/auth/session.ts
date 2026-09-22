import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { adminSessions, adminUsers } from "../db/schema.js";

/** Bumped at most once a minute so a busy admin is not a write per request. */
const LAST_SEEN_THROTTLE_MS = 60 * 1000;
const IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Short-lived: it only unlocks the TOTP step. */
const PENDING_TTL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  totpEnrolled: boolean;
}

export interface ActiveSession {
  id: string;
  userId: string;
  csrfToken: string;
  pendingTotp: boolean;
  createdAt: Date;
  ip: string | null;
  userAgent: string | null;
  user: SessionUser;
  /** The idle window was just slid forward, so the cookie should be re-issued to match. */
  refreshed: boolean;
}

/** A long-lived session is rotated periodically to shrink the theft window. */
export const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface IssuedSession {
  token: string;
  csrfToken: string;
  sessionId: string;
}

/** The cookie value is never stored — only its digest. */
function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function createSession(options: {
  userId: string;
  pendingTotp: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const now = Date.now();
  const idleMs = options.pendingTotp ? PENDING_TTL_MS : IDLE_TTL_MS;

  const [row] = await getDb()
    .insert(adminSessions)
    .values({
      userId: options.userId,
      tokenHash: hashToken(token),
      csrfToken,
      pendingTotp: options.pendingTotp,
      idleExpiresAt: new Date(now + idleMs),
      absoluteExpiresAt: new Date(now + ABSOLUTE_TTL_MS),
      ip: options.ip ?? null,
      userAgent: options.userAgent?.slice(0, 500) ?? null,
    })
    .returning({ id: adminSessions.id });

  if (!row) throw new Error("failed to create session");
  return { token, csrfToken, sessionId: row.id };
}

/**
 * One indexed lookup per request. No JWT and no blocklist, which is what makes
 * revocation instant rather than eventually-consistent.
 */
export async function resolveSession(token: string): Promise<ActiveSession | null> {
  const db = getDb();
  const now = new Date();

  const [row] = await db
    .select({
      id: adminSessions.id,
      userId: adminSessions.userId,
      csrfToken: adminSessions.csrfToken,
      pendingTotp: adminSessions.pendingTotp,
      createdAt: adminSessions.createdAt,
      ip: adminSessions.ip,
      userAgent: adminSessions.userAgent,
      lastSeenAt: adminSessions.lastSeenAt,
      idleExpiresAt: adminSessions.idleExpiresAt,
      absoluteExpiresAt: adminSessions.absoluteExpiresAt,
      revokedAt: adminSessions.revokedAt,
      email: adminUsers.email,
      totpSecret: adminUsers.totpSecret,
      isActive: adminUsers.isActive,
    })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(eq(adminSessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (!row.isActive) return null;
  if (row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) return null;

  // A pending-TOTP session keeps its fixed 5-minute window. Sliding it by the
  // full idle TTL would let a half-authenticated session live for hours.
  const refreshed =
    !row.pendingTotp && now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;

  if (refreshed) {
    const nextIdle = new Date(
      Math.min(now.getTime() + IDLE_TTL_MS, row.absoluteExpiresAt.getTime()),
    );
    await db
      .update(adminSessions)
      .set({ lastSeenAt: now, idleExpiresAt: nextIdle })
      .where(eq(adminSessions.id, row.id));
  }

  return {
    id: row.id,
    userId: row.userId,
    csrfToken: row.csrfToken,
    pendingTotp: row.pendingTotp,
    createdAt: row.createdAt,
    ip: row.ip,
    userAgent: row.userAgent,
    user: { id: row.userId, email: row.email, totpEnrolled: row.totpSecret !== null },
    refreshed,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb()
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessions.id, sessionId));
}

/** Used by "log out everywhere" and after a password change. */
export async function revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
  const rows = await getDb()
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(adminSessions.userId, userId),
        isNull(adminSessions.revokedAt),
        ...(exceptId ? [ne(adminSessions.id, exceptId)] : []),
      ),
    )
    .returning({ id: adminSessions.id });
  return rows.length;
}

/**
 * Excluded in SQL rather than revoked-then-reopened, so there is no moment in
 * which the kept session reads as revoked to a concurrent request.
 */
export function revokeOtherSessions(userId: string, keepId: string): Promise<number> {
  return revokeAllSessions(userId, keepId);
}

export async function listSessions(userId: string) {
  return getDb()
    .select({
      id: adminSessions.id,
      createdAt: adminSessions.createdAt,
      lastSeenAt: adminSessions.lastSeenAt,
      idleExpiresAt: adminSessions.idleExpiresAt,
      ip: adminSessions.ip,
      userAgent: adminSessions.userAgent,
    })
    .from(adminSessions)
    .where(and(eq(adminSessions.userId, userId), isNull(adminSessions.revokedAt)));
}

/** Housekeeping: expired rows carry no value once they can no longer resolve. */
export async function pruneSessions(): Promise<void> {
  const now = new Date();
  await getDb()
    .delete(adminSessions)
    .where(or(lt(adminSessions.absoluteExpiresAt, now), lt(adminSessions.idleExpiresAt, now)));
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let pruneTimer: NodeJS.Timeout | undefined;

export function startSessionPruning(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    void pruneSessions().catch((error) => console.error("[auth] pruning sessions failed", error));
  }, PRUNE_INTERVAL_MS);
  // Never hold the process open just to run housekeeping.
  pruneTimer.unref?.();
}
