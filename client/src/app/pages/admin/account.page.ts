import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardHeader,
  HlmCardTitle,
} from "@spartan-ng/helm/card";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService, type AdminSessionRow } from "../../admin/admin-api.service";
import { AdminSessionService } from "../../admin/admin-session.service";

@Component({
  selector: "app-admin-account",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardHeader,
    HlmCardTitle,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSkeleton,
    ReactiveFormsModule,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Account</h1>
        <p class="mt-1 text-sm text-muted-foreground">{{ session.user()?.email }}</p>
      </header>

      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle class="flex items-center gap-2 font-mono text-base">
            Two-factor authentication
            @if (session.user()?.totpEnrolled) {
              <span hlmBadge variant="secondary">enabled</span>
            } @else {
              <span hlmBadge variant="destructive">not enrolled</span>
            }
          </h2>
          <p hlmCardDescription>
            The admin panel is reachable from the public internet. Enrol an authenticator app.
          </p>
        </div>
        <div hlmCardContent class="flex flex-col gap-4">
          @if (recoveryCodes().length) {
            <div hlmAlert>
              <h3 hlmAlertTitle>Save these recovery codes</h3>
              <div hlmAlertDescription>
                <p class="m-0 mb-2">Each works once. They are shown only now.</p>
                <ul class="m-0 grid list-none grid-cols-2 gap-1 p-0 font-mono text-[0.8rem]">
                  @for (code of recoveryCodes(); track code) {
                    <li>{{ code }}</li>
                  }
                </ul>
              </div>
            </div>
          } @else if (qr()) {
            <div class="flex flex-col gap-3">
              <img
                [src]="qr()"
                alt="Authenticator QR code"
                class="h-44 w-44 rounded-lg bg-white p-2"
              />
              <p class="m-0 break-all font-mono text-[0.7rem] text-muted-foreground">
                {{ otpauthUri() }}
              </p>
              <form
                [formGroup]="confirmForm"
                (ngSubmit)="confirmTotp()"
                class="flex items-end gap-2"
              >
                <div hlmField class="flex-1">
                  <label hlmFieldLabel for="totp-code">Code from your app</label>
                  <input hlmInput id="totp-code" formControlName="code" class="font-mono" />
                </div>
                <button hlmBtn type="submit" [disabled]="busy()">Confirm</button>
              </form>
            </div>
          } @else if (!session.user()?.totpEnrolled) {
            <form [formGroup]="setupForm" (ngSubmit)="startTotp()" class="flex items-end gap-2">
              <div hlmField class="flex-1">
                <label hlmFieldLabel for="totp-password">Confirm your password</label>
                <input hlmInput id="totp-password" type="password" formControlName="password" />
              </div>
              <button hlmBtn type="submit" [disabled]="busy()">Set up</button>
            </form>
          } @else {
            <p class="m-0 text-sm text-muted-foreground">
              Two-factor authentication is active on this account.
            </p>
          }
        </div>
      </section>

      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle class="font-mono text-base">Change password</h2>
        </div>
        <div hlmCardContent>
          <form
            [formGroup]="passwordForm"
            (ngSubmit)="changePassword()"
            class="flex flex-col gap-3"
          >
            <div hlmField>
              <label hlmFieldLabel for="current">Current password</label>
              <input hlmInput id="current" type="password" formControlName="currentPassword" />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="next">New password</label>
              <input hlmInput id="next" type="password" formControlName="newPassword" />
              <p class="m-0 mt-1 text-[0.75rem] text-muted-foreground">
                At least 12 characters. All other sessions are signed out.
              </p>
            </div>
            <button hlmBtn type="submit" class="self-start" [disabled]="busy()">
              Update password
            </button>
          </form>
        </div>
      </section>

      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle class="font-mono text-base">Active sessions</h2>
        </div>
        <div hlmCardContent class="flex flex-col gap-3">
          @if (loadingSessions()) {
            <hlm-skeleton class="h-24 w-full" />
          } @else {
            @for (row of sessions(); track row.id) {
              <div
                class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div class="min-w-0">
                  <p class="m-0 font-mono text-[0.78rem]">
                    {{ row.ip || "unknown IP" }}
                    @if (row.current) {
                      <span hlmBadge variant="secondary" class="ml-2">this device</span>
                    }
                  </p>
                  <p class="m-0 mt-0.5 truncate text-[0.72rem] text-muted-foreground">
                    {{ row.userAgent || "unknown device" }} · last seen
                    {{ formatDate(row.lastSeenAt) }}
                  </p>
                </div>
                @if (!row.current) {
                  <button hlmBtn variant="outline" size="sm" (click)="revoke(row)">Revoke</button>
                }
              </div>
            }
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              class="self-start"
              (click)="signOutEverywhere()"
            >
              Sign out everywhere
            </button>
          }
        </div>
      </section>
    </div>
  `,
})
export default class AdminAccountPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);
  protected readonly session = inject(AdminSessionService);

  protected readonly busy = signal(false);
  protected readonly qr = signal<string | null>(null);
  protected readonly otpauthUri = signal("");
  protected readonly recoveryCodes = signal<string[]>([]);
  protected readonly sessions = signal<AdminSessionRow[]>([]);
  protected readonly loadingSessions = signal(true);

  protected readonly setupForm = this.fb.nonNullable.group({
    password: ["", Validators.required],
  });
  protected readonly confirmForm = this.fb.nonNullable.group({
    code: ["", [Validators.required, Validators.minLength(6)]],
  });
  protected readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: ["", Validators.required],
    newPassword: ["", [Validators.required, Validators.minLength(12)]],
  });

  ngOnInit(): void {
    void this.loadSessions();
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private async loadSessions(): Promise<void> {
    const result = await this.api.sessions();
    this.loadingSessions.set(false);
    if (result.ok) this.sessions.set(result.data.sessions);
  }

  protected async startTotp(): Promise<void> {
    if (this.setupForm.invalid || this.busy()) return;
    this.busy.set(true);

    const result = await this.api.totpSetup(this.setupForm.getRawValue().password);
    this.busy.set(false);

    if (!result.ok) {
      toast.error("Could not start enrolment", {
        description: result.error === "invalid_credentials" ? "Wrong password." : result.error,
      });
      return;
    }

    this.qr.set(`data:image/svg+xml;utf8,${encodeURIComponent(result.data.qrSvg)}`);
    this.otpauthUri.set(result.data.otpauthUri);
    this.setupForm.reset();
  }

  protected async confirmTotp(): Promise<void> {
    if (this.confirmForm.invalid || this.busy()) return;
    this.busy.set(true);

    const result = await this.api.totpConfirm(this.confirmForm.getRawValue().code.trim());
    this.busy.set(false);

    if (!result.ok) {
      toast.error("Code not accepted", { description: "Check the code and try again." });
      return;
    }

    this.recoveryCodes.set(result.data.recoveryCodes);
    this.qr.set(null);
    this.confirmForm.reset();
    await this.session.ensure(true);
    toast.success("Two-factor authentication enabled");
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm.invalid || this.busy()) return;
    this.busy.set(true);

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    const result = await this.api.changePassword(currentPassword, newPassword);
    this.busy.set(false);

    if (!result.ok) {
      toast.error("Could not change password", {
        description:
          result.error === "invalid_credentials" ? "Current password is wrong." : result.error,
      });
      return;
    }

    this.passwordForm.reset();
    await this.loadSessions();
    toast.success("Password updated", { description: "Other sessions were signed out." });
  }

  protected async revoke(row: AdminSessionRow): Promise<void> {
    const result = await this.api.revokeSession(row.id);
    if (!result.ok) {
      toast.error("Could not revoke", { description: result.error });
      return;
    }
    await this.loadSessions();
  }

  protected async signOutEverywhere(): Promise<void> {
    const result = await this.api.revokeSession("others");
    if (!result.ok) {
      toast.error("Could not sign out other sessions", { description: result.error });
      return;
    }
    await this.loadSessions();
    toast.success("Other sessions signed out");
  }
}
