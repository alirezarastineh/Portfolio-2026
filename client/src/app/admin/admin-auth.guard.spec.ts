import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router, UrlTree, type RouterStateSnapshot } from "@angular/router";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";

import { adminAuthGuard } from "./admin-auth.guard";
import { AdminSessionService } from "./admin-session.service";

class StubSession {
  authenticated = false;
  ensureCalls = 0;

  async ensure(): Promise<boolean> {
    this.ensureCalls++;
    return this.authenticated;
  }
}

function run(url: string, platform: "browser" | "server" | object, session: StubSession) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platform },
      { provide: AdminSessionService, useValue: session },
    ],
  });

  return TestBed.runInInjectionContext(() =>
    adminAuthGuard({} as never, { url } as RouterStateSnapshot),
  );
}

describe("adminAuthGuard", () => {
  let session: StubSession;

  beforeEach(() => {
    session = new StubSession();
  });

  it("redirects an unauthenticated visitor to the login page", async () => {
    const result = await run("/admin/seo", "browser", session);

    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toContain("/admin/login");
  });

  it("preserves the requested url so login can return there", async () => {
    const result = await run("/admin/seo", "browser", session);
    expect((result as UrlTree).queryParams["r"]).toBe("/admin/seo");
  });

  it("does not add a redirect param for the admin root", async () => {
    const result = await run("/admin", "browser", session);
    expect((result as UrlTree).queryParams["r"]).toBeUndefined();
  });

  it("allows an authenticated visitor through", async () => {
    session.authenticated = true;
    expect(await run("/admin/seo", "browser", session)).toBe(true);
  });

  /**
   * The login route is a child of the admin layout, so without an explicit
   * bypass the guard would redirect the login page to itself.
   */
  it("lets the login route through without checking the session", async () => {
    expect(await run("/admin/login", "browser", session)).toBe(true);
    expect(session.ensureCalls).toBe(0);
  });

  /** SSR cannot read a cookie scoped to the API origin; the browser decides. */
  it("defers to the browser during server rendering", async () => {
    expect(await run("/admin/seo", "server", session)).toBe(true);
    expect(session.ensureCalls).toBe(0);
  });
});

describe("Router integration", () => {
  it("builds a login UrlTree the router can serialize", async () => {
    const result = await run("/admin/projects", "browser", new StubSession());
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result as UrlTree)).toBe(
      "/admin/login?r=%2Fadmin%2Fprojects",
    );
  });
});
