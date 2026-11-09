import { HttpClient, provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminApiInterceptor, isAdminCall } from "./admin-api.interceptor";
import { AdminSessionService } from "./admin-session.service";

const API = "https://api.test";

describe("adminApiInterceptor", () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let session: { lose: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    session = { lose: vi.fn() };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([adminApiInterceptor])),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: "browser" },
        { provide: AdminSessionService, useValue: session },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  function failWith(path: string, status: number, error: string, method = "GET"): void {
    http.request(method, `${API}${path}`).subscribe({ error: () => undefined });
    backend.expectOne(`${API}${path}`).flush({ error }, { status, statusText: "Error" });
  }

  it("reports a lost session, and leaves the page where it is", () => {
    failWith("/admin/status", 401, "unauthenticated");

    expect(session.lose).toHaveBeenCalledOnce();
  });

  it("treats a half-authenticated session the same way", () => {
    failWith("/admin/status", 401, "totp_required");

    expect(session.lose).toHaveBeenCalledOnce();
  });

  /**
   * Regression: every 401 used to redirect, so a mistyped password on the
   * login page bounced to `/admin/login?r=/admin/login`, and a wrong current
   * password on the account page signed the admin out.
   */
  it("leaves a wrong password to the form that asked", () => {
    failWith("/auth/login", 401, "invalid_credentials", "POST");

    expect(session.lose).not.toHaveBeenCalled();
  });

  it("leaves a wrong TOTP code to the form that asked", () => {
    failWith("/auth/totp", 401, "invalid_code", "POST");

    expect(session.lose).not.toHaveBeenCalled();
  });

  it("leaves the session probe the guard relies on alone", () => {
    failWith("/auth/me", 401, "unauthenticated");

    expect(session.lose).not.toHaveBeenCalled();
  });

  /** Regression: the old pattern matched `/auth` anywhere, so a post slug `auth` counted. */
  it("recognises admin calls by the start of the path only", () => {
    expect(isAdminCall(`${API}/admin/status`)).toBe(true);
    expect(isAdminCall(`${API}/auth/me`)).toBe(true);
    expect(isAdminCall(`${API}/admin`)).toBe(true);
    expect(isAdminCall("/api/v1/content/en/posts/auth")).toBe(false);
    expect(isAdminCall("/api/v2/content/de/posts/admin")).toBe(false);
    expect(isAdminCall(`${API}/administrator`)).toBe(false);
  });

  it("sends credentials on admin calls only", () => {
    http.get(`${API}/admin/status`).subscribe();
    http.get("/api/v1/content/en").subscribe();

    const admin = backend.expectOne(`${API}/admin/status`);
    const content = backend.expectOne("/api/v1/content/en");

    expect(admin.request.withCredentials).toBe(true);
    expect(content.request.withCredentials).toBe(false);

    admin.flush({});
    content.flush({});
  });
});
