import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  Injector,
  input,
  model,
  OnInit,
  output,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { BrnInputOtp, BrnInputOtpInput } from "@spartan-ng/brain/input-otp";
import { HlmAlert, HlmAlertDescription } from "@spartan-ng/helm/alert";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmInputOtpImports } from "@spartan-ng/helm/input-otp";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { AdminApiService, type AdminUser } from "../admin-api.service";

export type SignInStep = "credentials" | "totp";

const ERROR_COPY: Record<string, string> = {
  invalid_credentials: "Incorrect email or password.",
  invalid_code: "That code was not accepted. Try the next one, or a recovery code.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  origin_rejected: "This origin is not allowed to sign in. Check ADMIN_ORIGIN.",
  csrf_invalid: "Your session expired mid-request. Reload and try again.",
  invalid_input: "Check the form and try again.",
  network_error: "Could not reach the API.",
};

/**
 * The two steps of signing in, the password and the code: on the login page,
 * and over an open page when the session is lost (`session-dialog`). What the
 * outcome means is the holder's: the page navigates, the dialog closes.
 */
@Component({
  selector: "app-sign-in-form",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BrnInputOtp,
    BrnInputOtpInput,
    HlmAlert,
    HlmAlertDescription,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmInputOtpImports,
    HlmSpinner,
    ReactiveFormsModule,
  ],
  host: { class: "block" },
  template: `
    @if (error()) {
      <div hlmAlert variant="destructive" class="mb-4">
        <p hlmAlertDescription>{{ error() }}</p>
      </div>
    }

    @if (step() === "credentials") {
      <form [formGroup]="credentials" (ngSubmit)="submitCredentials()" class="flex flex-col gap-4">
        <div hlmField>
          <label hlmFieldLabel [for]="idPrefix() + 'email'">Email</label>
          <input
            hlmInput
            [id]="idPrefix() + 'email'"
            type="email"
            autocomplete="username"
            formControlName="email"
            [attr.aria-invalid]="showError('email') ? 'true' : null"
          />
        </div>
        <div hlmField>
          <label hlmFieldLabel [for]="idPrefix() + 'password'">Password</label>
          <input
            hlmInput
            [id]="idPrefix() + 'password'"
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
            <label hlmFieldLabel [for]="idPrefix() + 'code'" class="self-start">Code</label>
            <!-- Submits itself on the sixth digit; no need to reach for the button. -->
            <brn-input-otp
              hlmInputOtp
              [inputId]="idPrefix() + 'code'"
              [length]="6"
              autofocus
              formControlName="code"
              (completed)="submitTotp()"
            >
              <div hlmInputOtpGroup>
                @for (slot of slots; track slot) {
                  <hlm-input-otp-slot [index]="slot" />
                }
              </div>
              <!-- Brain 1.9 renders no input of its own (numeric, one-time-code by default).
                   Last, so it lies over the slots and takes the clicks. -->
              <input brnInputOtpInput />
            </brn-input-otp>
          </div>
        } @else {
          <div hlmField>
            <label hlmFieldLabel [for]="idPrefix() + 'recovery'">Recovery code</label>
            <input
              hlmInput
              [id]="idPrefix() + 'recovery'"
              autocomplete="off"
              spellcheck="false"
              placeholder="ABCDE-FGHJK"
              formControlName="code"
              class="font-data uppercase"
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
  `,
})
export class SignInFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** Filled in when it is known: only the password is left to type. */
  readonly email = input("");
  /** Keeps the fields' ids apart from those of the page underneath. */
  readonly idPrefix = input("");
  readonly step = model<SignInStep>("credentials");

  /** The password was right, and a code is still wanted. */
  readonly codeNeeded = output<void>();
  readonly signedIn = output<AdminUser>();
  /** A wrong password or code. */
  readonly refused = output<void>();
  /** "Use a different account": back at the password step. */
  readonly startedOver = output<void>();

  /**
   * The TOTP step also accepts single-use recovery codes (`ABCDE-FGHJK`), which
   * a six-slot OTP input cannot hold — so it switches to a plain field.
   */
  protected readonly useRecovery = signal(false);
  protected readonly slots = [0, 1, 2, 3, 4, 5];
  protected readonly busy = signal(false);
  protected readonly error = signal("");

  private gone = false;

  protected readonly credentials = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required]],
  });

  protected readonly totp = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.minLength(6)]],
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
  }

  ngOnInit(): void {
    if (this.email()) this.credentials.controls.email.setValue(this.email());
  }

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
      this.refused.emit();
      return;
    }

    if (result.data.totpRequired) {
      this.codeNeeded.emit();
      this.step.set("totp");
      return;
    }

    if (result.data.user) this.signedIn.emit(result.data.user);
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
      this.refused.emit();
      // Clear the slots: with auto-submit, a wrong code otherwise sits there
      // full and has to be deleted digit by digit before the next attempt.
      this.totp.reset();
      return;
    }

    this.signedIn.emit(result.data.user);
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
    this.startedOver.emit();
    // The button is gone with its step: the form it went back to takes the focus.
    afterNextRender(
      {
        read: () => {
          if (!this.gone) this.doc.getElementById(`${this.idPrefix()}email`)?.focus();
        },
      },
      { injector: this.injector },
    );
  }
}
