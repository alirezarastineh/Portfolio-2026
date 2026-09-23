import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";

import { readCsrfCookie, readSessionToken, setSessionCookies } from "./cookies.js";
import {
  createSession,
  resolveSession,
  revokeSession,
  ROTATE_AFTER_MS,
  type ActiveSession,
} from "./session.js";

declare module "hono" {
  interface ContextVariableMap {
    session: ActiveSession;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function adminOrigins(): string[] {
  return (process.env.ADMIN_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function clientIp(c: Context): string {
  // Only Caddy can reach the container (ports bind to 127.0.0.1), so the
  // forwarded headers are trustworthy here — same assumption contact.ts makes.
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
  );
}

/**
 * `admin_sessions.ip` is Postgres `inet`, which rejects the "unknown"
 * placeholder that `clientIp` falls back to for rate-limit bucketing. Anything
 * that is not a real address is stored as NULL.
 */
export function clientIpOrNull(c: Context): string | null {
  const raw = clientIp(c);
  return isIP(raw) ? raw : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * CSRF layer 1, and the one that actually carries the weight: reject any
 * state-changing request whose Origin is absent or not allow-listed.
 */
export const requireTrustedOrigin: MiddlewareHandler = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header("origin");
  if (!origin || !adminOrigins().includes(origin)) {
    return c.json({ error: "origin_rejected" }, 403);
  }
  return next();
};

/**
 * Loads and validates the session. Pending-TOTP sessions are resolved but
 * flagged, so only the TOTP endpoint can accept them.
 */
export const loadSession: MiddlewareHandler = async (c, next) => {
  const token = readSessionToken(c);
  if (!token) return c.json({ error: "unauthenticated" }, 401);

  const resolved = await resolveSession(token);
  if (!resolved) return c.json({ error: "unauthenticated" }, 401);

  const session = await rotateIfStale(c, resolved);

  // The DB idle window slides with activity; the cookie has to slide with it.
  // Otherwise its fixed Max-Age logs an active admin out 8h after sign-in, and
  // the 24h rotation and 30-day absolute lifetime are never reached. Rotation
  // already issued fresh cookies, so this only covers the unrotated case.
  if (session === resolved && resolved.refreshed) {
    setSessionCookies(c, token, resolved.csrfToken);
  }

  c.set("session", session);
  return next();
};

/**
 * Opportunistic rotation: a session in continuous use for over a day is
 * replaced with a fresh one, shrinking the window in which a stolen cookie
 * stays useful. Skipped for pending-TOTP sessions, which are short-lived and
 * rotated by the TOTP step anyway.
 *
 * Rotation must not break the in-flight request, so a failure keeps the
 * existing session rather than returning 401.
 */
async function rotateIfStale(c: Context, session: ActiveSession): Promise<ActiveSession> {
  if (session.pendingTotp) return session;
  if (Date.now() - session.createdAt.getTime() < ROTATE_AFTER_MS) return session;

  try {
    const issued = await createSession({
      userId: session.userId,
      pendingTotp: false,
      ip: clientIpOrNull(c),
      userAgent: c.req.header("user-agent"),
    });
    await revokeSession(session.id);
    setSessionCookies(c, issued.token, issued.csrfToken);

    // Keep the OLD csrfToken on the in-flight session: `requireCsrf` runs
    // after this middleware and compares against the header the client already
    // sent. Swapping it here would reject every request the moment a session
    // crossed the rotation age. The new token applies from the next request.
    return { ...session, id: issued.sessionId, createdAt: new Date() };
  } catch (error) {
    console.error("[auth] session rotation failed", error);
    return session;
  }
}

/** A half-authenticated session must not reach anything but the TOTP step. */
export const requireFullSession: MiddlewareHandler = async (c, next) => {
  if (c.get("session").pendingTotp) {
    return c.json({ error: "totp_required" }, 401);
  }
  return next();
};

/**
 * CSRF layer 3: double-submit. The cookie is readable by JS and must be echoed
 * in the header, which a cross-origin attacker cannot read. Layer 2 (JSON-only
 * bodies forcing a preflight) is enforced by the route validators.
 */
export const requireCsrf: MiddlewareHandler = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method)) return next();

  const header = c.req.header("x-csrf-token");
  const cookie = readCsrfCookie(c);
  const session = c.get("session");

  if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(header, session.csrfToken)) {
    return c.json({ error: "csrf_invalid" }, 403);
  }
  return next();
};

/** The standard stack for an authenticated, state-changing admin endpoint. */
export const requireAdmin: MiddlewareHandler[] = [
  requireTrustedOrigin,
  loadSession,
  requireFullSession,
  requireCsrf,
];
