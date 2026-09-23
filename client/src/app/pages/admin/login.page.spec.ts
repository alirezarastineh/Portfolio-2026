import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminApiService, type ApiResult } from "../../admin/admin-api.service";
import { AdminSessionService } from "../../admin/admin-session.service";
import AdminLoginPage from "./login.page";

type LoginPayload = { ok: true; totpRequired: boolean; user: unknown };

class StubApi {
  loginResult: ApiResult<LoginPayload> = {
    ok: true,
    data: { ok: true, totpRequired: false, user: { id: "1", email: "a@b.c", totpEnrolled: false } },
  };
  totpResult: ApiResult<unknown> = { ok: true, data: { ok: true, user: {} } };
  calls: string[] = [];

  async login(email: string) {
    this.calls.push(`login:${email}`);
    return this.loginResult;
  }
  async verifyTotp(code: string) {
    this.calls.push(`totp:${code}`);
    return this.totpResult;
  }
  async logout() {
    this.calls.push("logout");
    return { ok: true as const, data: { ok: true as const } };
  }
}

function setup() {
  TestBed.resetTestingModule();
  const api = new StubApi();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AdminApiService, useValue: api },
      AdminSessionService,
    ],
  });
  const fixture = TestBed.createComponent(AdminLoginPage);
  fixture.detectChanges();
  return { fixture, api };
}

const text = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.textContent ?? "";

describe("AdminLoginPage", () => {
  beforeEach(() => {
    try {
      document.cookie = "pf_csrf=; Path=/; Max-Age=0";
    } catch {
      /* ignore */
    }
  });

  /**
   * The form must render on its own. The admin layout deliberately exempts the
   * login route from the session check — if that exemption regresses, the page
   * sits behind a skeleton forever and nobody can sign in.
   */
  it("renders the credentials form immediately", () => {
    const { fixture } = setup();
    const inputs = fixture.nativeElement.querySelectorAll("input");

    expect(inputs).toHaveLength(2);
    expect(fixture.nativeElement.querySelector("#email")).toBeTruthy();
    expect(fixture.nativeElement.querySelector("#password")).toBeTruthy();
  });

  it("does not call the API until the form is valid", async () => {
    const { fixture, api } = setup();
    await fixture.componentInstance["submitCredentials"]();

    expect(api.calls).toEqual([]);
  });

  it("advances to the TOTP step when the server asks for one", async () => {
    const { fixture, api } = setup();
    api.loginResult = { ok: true, data: { ok: true, totpRequired: true, user: null } };

    fixture.componentInstance["credentials"].setValue({
      email: "admin@example.com",
      password: "hunter2hunter2",
    });
    await fixture.componentInstance["submitCredentials"]();
    fixture.detectChanges();

    expect(fixture.componentInstance["step"]()).toBe("totp");
    expect(text(fixture)).toContain("two-factor");
    expect(fixture.nativeElement.querySelector("#code")).toBeTruthy();
  });

  it("surfaces a readable message instead of a raw error code", async () => {
    const { fixture, api } = setup();
    api.loginResult = { ok: false, error: "invalid_credentials", status: 401 };

    fixture.componentInstance["credentials"].setValue({
      email: "admin@example.com",
      password: "wrong-password",
    });
    await fixture.componentInstance["submitCredentials"]();
    fixture.detectChanges();

    expect(fixture.componentInstance["error"]()).toBe("Incorrect email or password.");
    expect(text(fixture)).not.toContain("invalid_credentials");
  });

  it("falls back to a generic message for an unrecognised error", async () => {
    const { fixture, api } = setup();
    api.loginResult = { ok: false, error: "teapot", status: 418 };

    fixture.componentInstance["credentials"].setValue({
      email: "admin@example.com",
      password: "hunter2hunter2",
    });
    await fixture.componentInstance["submitCredentials"]();

    expect(fixture.componentInstance["error"]()).toBe("Sign-in failed.");
  });
});
