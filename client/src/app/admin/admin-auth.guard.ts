import { isPlatformBrowser } from "@angular/common";
import { inject, PLATFORM_ID } from "@angular/core";
import { Router, type CanActivateChildFn } from "@angular/router";

import { AdminSessionService } from "./admin-session.service";

/**
 * Returning `true` during SSR is deliberate: the session cookie is scoped to
 * the API origin, so the server has no cheap way to validate it. The admin
 * shell renders a skeleton, the browser hydrates, and an unauthenticated
 * visitor is redirected here a moment later. A brief skeleton in an admin panel
 * is an acceptable trade; all admin data calls are separately browser-gated.
 */
export const adminAuthGuard: CanActivateChildFn = async (_route, state) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  // The login route is a child of the admin layout, so without this the guard
  // would redirect the login page to itself.
  if (state.url.startsWith("/admin/login")) return true;

  const session = inject(AdminSessionService);
  const router = inject(Router);

  if (await session.ensure()) return true;

  // A half-authenticated session belongs on the login screen's TOTP step.
  return router.createUrlTree(["/admin/login"], {
    queryParams: state.url === "/admin" ? {} : { r: state.url },
  });
};
