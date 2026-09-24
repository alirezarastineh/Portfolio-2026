import type { HttpInterceptorFn } from "@angular/common/http";
import { inject, PLATFORM_ID } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { Router } from "@angular/router";
import { catchError, from, switchMap, throwError } from "rxjs";

import { AdminSessionService } from "./admin-session.service";

const CSRF_COOKIE = "pf_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 401s that mean the session itself is gone. Every other 401 — a wrong
 * password, a wrong TOTP code — is an answer to the form that asked, and must
 * stay there rather than bounce the admin to the login screen.
 */
const SESSION_LOST = new Set(["unauthenticated", "totp_required"]);

/** The double-submit CSRF token, for requests made outside HttpClient (the playground stream). */
export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;

  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Anchored to the start of the path: the API's `/admin/…` and `/auth/…`
 * routes. Matching anywhere in the URL once let a public URL that merely
 * ended in `/auth` (a post slug, say) go out with credentials.
 */
export function isAdminCall(url: string): boolean {
  let path: string;
  try {
    path = new URL(url, "https://relative.invalid").pathname;
  } catch {
    return false;
  }
  return /^\/(auth|admin)(\/|$)/.test(path);
}

/**
 * Adds credentials and the CSRF header to admin calls only, and funnels a lost
 * session back to the login screen.
 *
 * `withCredentials: true` also disables Angular's HTTP transfer cache for these
 * requests, which is exactly right — an authenticated response must never be
 * serialized into the SSR payload.
 */
export const adminApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isAdminCall(req.url)) return next(req);

  const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  const router = inject(Router);
  const session = inject(AdminSessionService);

  let retried = false;
  let request = req.clone({ withCredentials: true });

  if (isBrowser && !SAFE_METHODS.has(req.method)) {
    const csrf = readCsrfCookie();
    if (csrf) {
      request = request.clone({ setHeaders: { "X-CSRF-Token": csrf } });
    }
  }

  return next(request).pipe(
    catchError((error: unknown) => {
      const status = (error as { status?: number })?.status;
      const code = (error as { error?: { error?: string } })?.error?.error;

      // Not on /auth/me: the guard calls it precisely to discover that there is
      // no session, and redirecting from here would fight the guard.
      if (
        status === 401 &&
        code !== undefined &&
        SESSION_LOST.has(code) &&
        isBrowser &&
        !req.url.endsWith("/auth/me")
      ) {
        // Cleared, not just redirected: otherwise the guard's cached answer
        // keeps reporting a session that the server has already dropped.
        session.clear();

        const here = router.url;
        void router.navigate(["/admin/login"], {
          queryParams: here.startsWith("/admin/login") ? {} : { r: here },
        });
        return throwError(() => error);
      }

      // A rotated session leaves the page holding a stale CSRF token. Re-read
      // the cookie once and replay; only once, so a genuinely wrong token
      // cannot loop.
      if (status === 403 && code === "csrf_invalid" && isBrowser && !retried) {
        retried = true;
        const fresh = readCsrfCookie();
        if (fresh && fresh !== request.headers.get("X-CSRF-Token")) {
          return from(Promise.resolve()).pipe(
            switchMap(() => next(request.clone({ setHeaders: { "X-CSRF-Token": fresh } }))),
          );
        }
      }

      return throwError(() => error);
    }),
  );
};
