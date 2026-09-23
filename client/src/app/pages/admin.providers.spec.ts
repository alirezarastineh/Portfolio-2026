import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  PLATFORM_ID,
  type Provider,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminApiService } from "../admin/admin-api.service";
import { AdminSessionService } from "../admin/admin-session.service";
import { UiSectionService } from "../admin/ui-section.service";
import { routeMeta } from "./admin.page";

/**
 * The admin's HttpClient, interceptor and API services live on the admin
 * route, not the root. These pin the two ways that move could silently break:
 * a service resolving a root HttpClient (no credentials, no CSRF header), and
 * a root-level consumer quietly getting a second, unintercepted instance.
 */
describe("admin route providers", () => {
  let backend: HttpTestingController;
  let admin: EnvironmentInjector;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: "browser" },
      ],
    });
    backend = TestBed.inject(HttpTestingController);

    const providers = "providers" in routeMeta ? (routeMeta.providers as Provider[]) : [];
    admin = createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));
  });

  afterEach(() => {
    backend.verify();
    admin.destroy();
  });

  it("sends admin API calls through the admin interceptor", () => {
    void admin.get(AdminApiService).me();

    const request = backend.expectOne((req) => req.url.endsWith("/auth/me"));
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user: null, pendingTotp: false, csrfToken: "x" });
  });

  it("shares one session and one UI-section service across the admin", () => {
    expect(admin.get(AdminSessionService)).toBe(admin.get(AdminSessionService));
    expect(admin.get(UiSectionService)).toBe(admin.get(UiSectionService));
  });

  it("cannot be injected outside the admin route", () => {
    expect(() => TestBed.inject(AdminApiService)).toThrow(/No provider/);
  });
});
