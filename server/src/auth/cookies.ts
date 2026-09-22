import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "pf_sid";
export const CSRF_COOKIE = "pf_csrf";

/**
 * Matches the session idle window, so an unused cookie dies with the session.
 * `loadSession` re-issues it as the window slides, so activity keeps it alive.
 */
export const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60;

interface CookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
  maxAge: number;
  domain?: string;
}

/**
 * `SameSite=Lax`, deliberately not `None`.
 *
 * The admin runs on alirezarastineh.me and the API on api.alirezarastineh.me.
 * "Same-site" is defined by the registrable domain (eTLD+1), not by origin, so
 * those are same-site but cross-origin: `Lax` does not restrict the request for
 * any method. `None` would be strictly worse — it would also permit genuinely
 * cross-site requests.
 *
 * `Secure` is gated on production because `http://localhost` silently drops
 * secure cookies, which makes local development impossible to debug.
 */
function baseOptions(httpOnly: boolean): CookieOptions {
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  return {
    path: "/",
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    ...(domain ? { domain } : {}),
  };
}

export function setSessionCookies(c: Context, token: string, csrfToken: string): void {
  setCookie(c, SESSION_COOKIE, token, baseOptions(true));
  // Readable by JS on purpose: the admin echoes it back in X-CSRF-Token.
  setCookie(c, CSRF_COOKIE, csrfToken, baseOptions(false));
}

export function clearSessionCookies(c: Context): void {
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  const options = { path: "/", ...(domain ? { domain } : {}) };
  deleteCookie(c, SESSION_COOKIE, options);
  deleteCookie(c, CSRF_COOKIE, options);
}

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function readCsrfCookie(c: Context): string | undefined {
  return getCookie(c, CSRF_COOKIE);
}
