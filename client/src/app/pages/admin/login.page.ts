import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { HlmAlert, HlmAlertDescription } from "@spartan-ng/helm/alert";
import { HlmButton } from "@spartan-ng/helm/button";
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardHeader,
  HlmCardTitle,
} from "@spartan-ng/helm/card";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { BrnInputOtp } from "@spartan-ng/brain/input-otp";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmInputOtpImports } from "@spartan-ng/helm/input-otp";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService } from "../../admin/admin-api.service";
import { AdminSessionService } from "../../admin/admin-session.service";

type Step = "credentials" | "totp";

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  invalid_code: "That code was not accepted. Try the next one, or a recovery code.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  origin_rejected: "This origin is not allowed to sign in. Check ADMIN_ORIGIN.",
  csrf_invalid: "Your session expired mid-request. Reload and try again.",
  invalid_input: "Check the form and try again.",
  network_error: "Could not reach the API.",
};

@Component({
  selector: "app-admin-login",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardHeader,
    HlmCardTitle,
    HlmField,
    HlmFieldLabel,
    BrnInputOtp,
    HlmInput,
    HlmInputOtpImports,
    HlmSpinner,
    ReactiveFormsModule,
  ],
  host: { class: "block" },
  template: `
    <main class="flex min-h-screen items-center justify-center px-6 py-12">
      <section hlmCard class="w-full max-w-sm">
        <div hlmCardHeader>
          <h1 hlmCardTitle class="font-mono">
            {{ step() === "credentials" ? "admin" : "two-factor" }}
          </h1>
          <p hlmCardDescription>
            {{
              step() === "credentials"
                ? "Sign in to edit site content."
                : "Enter the 6-digit code from your authenticator, or a recovery code."
            }}
          </p>
        </div>

        <div hlmCardContent>
          @if (error()) {
            <div hlmAlert variant="destructive" class="mb-4">
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }

          @if (step() === "credentials") {
            <form
              [formGroup]="credentials"
              (ngSubmit)="submitCredentials()"
              class="flex flex-col gap-4"
            >
              <div hlmField>
                <label hlmFieldLabel for="email">Email</label>
                <input
                  hlmInput
                  id="email"
                  type="email"
                  autocomplete="username"
                  formControlName="email"
                  [attr.aria-invalid]="showError('email') ? 'true' : null"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="password">Password</label>
                <input
                  hlmInput
                  id="password"
                  type="password"
                  autocomplete="current-password"
                  formControlName="password"
                  [attr.aria-invalid]="showError('password') ? 'true' : null"
                />
              </div>
              <button hlmBtn type="submit" [disabled]="busy()">
                @if (busy()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  Sign in
                }
              </button>
            </form>
          } @else {
            <form [formGroup]="totp" (ngSubmit)="submitTotp()" class="flex flex-col gap-4">
              @if (!useRecovery()) {
                <div hlmField class="items-center">
                  <label hlmFieldLabel for="code" class="self-start">Code</label>
                  <!-- Submits itself on the sixth digit; no need to reach for the button. -->
                  <brn-input-otp
                    hlmInputOtp
                    inputId="code"
                    [length]="6"
                    inputMode="numeric"
                    autofocus
                    formControlName="code"
                    (completed)="submitTotp()"
                  >
                    <div hlmInputOtpGroup>
                      @for (slot of slots; track slot) {
                        <hlm-input-otp-slot [index]="slot" />
                      }
                    </div>
                  </brn-input-otp>
                </div>
              } @else {
                <div hlmField>
                  <label hlmFieldLabel for="recovery">Recovery code</label>
                  <input
                    hlmInput
                    id="recovery"
                    autocomplete="off"
                    placeholder="ABCDE-FGHJK"
                    formControlName="code"
                    class="font-mono uppercase tracking-[0.15em]"
                  />
                </div>
              }
              <button hlmBtn type="submit" [disabled]="busy()">
                @if (busy()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  Verify
                }
              </button>
              <button hlmBtn variant="link" type="button" size="sm" (click)="toggleRecovery()">
                {{
                  useRecovery()
                    ? "Use an authenticator code instead"
                    : "Lost your device? Use a recovery code"
                }}
              </button>
              <button hlmBtn variant="ghost" type="button" (click)="backToCredentials()">
                Use a different account
              </button>
            </form>
          }
        </div>
      </section>
    </main>
  `,
})
export default class AdminLoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly step = signal<Step>("credentials");
  /**
   * The TOTP step also accepts single-use recovery codes (`ABCDE-FGHJK`), which
   * a six-slot OTP input cannot hold — so it switches to a plain field.
   */
  protected readonly useRecovery = signal(false);
  protected readonly slots = [0, 1, 2, 3, 4, 5];
  protected readonly busy = signal(false);
  protected readonly error = signal("");

  protected readonly credentials = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required]],
  });

  protected readonly totp = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.minLength(6)]],
  });

  protected showError(field: "email" | "password"): boolean {
    const control = this.credentials.controls[field];
    return control.invalid && (control.dirty || control.touched);
  }

  protected async submitCredentials(): Promise<void> {
    this.credentials.markAllAsTouched();
    if (this.credentials.invalid || this.busy()) return;

    this.busy.set(true);
    this.error.set("");

    const { email, password } = this.credentials.getRawValue();
    const result = await this.api.login(email.trim(), password);
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(ERROR_COPY[result.error] ?? "Sign-in failed.");
      return;
    }

    if (result.data.totpRequired) {
      this.session.adopt(null, true);
      this.step.set("totp");
      return;
    }

    this.session.adopt(result.data.user, false);
    await this.finish();
  }

  protected async submitTotp(): Promise<void> {
    this.totp.markAllAsTouched();
    if (this.totp.invalid || this.busy()) return;

    this.busy.set(true);
    this.error.set("");

    const result = await this.api.verifyTotp(this.totp.getRawValue().code.trim());
    this.busy.set(false);

    if (!result.ok) {
      this.error.set(ERROR_COPY[result.error] ?? "Verification failed.");
      // Clear the slots: with auto-submit, a wrong code otherwise sits there
      // full and has to be deleted digit by digit before the next attempt.
      this.totp.reset();
      return;
    }

    this.session.adopt(result.data.user, false);
    await this.finish();
  }

  protected toggleRecovery(): void {
    this.useRecovery.update((v) => !v);
    this.totp.reset();
    this.error.set("");
  }

  protected backToCredentials(): void {
    this.step.set("credentials");
    this.useRecovery.set(false);
    this.error.set("");
    this.totp.reset();
    void this.api.logout().then(() => this.session.clear());
  }

  /**
   * Honour the `?r=` the guard attached, but never bounce outside /admin — and
   * never back to the login page itself, which would strand a signed-in admin
   * on the form they just completed.
   */
  private async finish(): Promise<void> {
    const requested = this.route.snapshot.queryParamMap.get("r");
    const target =
      requested?.startsWith("/admin") && !requested.startsWith("/admin/login")
        ? requested
        : "/admin";
    await this.router.navigateByUrl(target);
  }
}
