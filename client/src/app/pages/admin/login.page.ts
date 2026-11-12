import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { AdminApiService, type AdminUser } from "../../admin/admin-api.service";
import { AdminSessionService } from "../../admin/admin-session.service";
import {
  SignInFormComponent,
  type SignInStep,
} from "../../admin/components/sign-in-form.component";

/** One plain form under the site's wordmark and its full stop (plan 5, U8). */
@Component({
  selector: "app-admin-login",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SignInFormComponent],
  host: { class: "block" },
  template: `
    <main class="flex min-h-screen items-center justify-center px-4 py-12">
      <div class="flex w-full max-w-sm flex-col gap-6">
        <p class="m-0 text-sm font-semibold text-foreground">
          <span translate="no">Alireza Rastineh</span
          ><span class="text-signal" aria-hidden="true">.</span>
        </p>
        <div class="flex flex-col gap-1">
          <h1 class="m-0 text-page-title text-foreground">
            {{ step() === "credentials" ? "Sign in" : "Two-factor code" }}
          </h1>
          @if (step() === "totp") {
            <p class="m-0 text-hint text-muted-foreground">
              Enter the 6-digit code from your authenticator, or a recovery code.
            </p>
          }
        </div>
        <app-sign-in-form
          [(step)]="step"
          (codeNeeded)="session.adopt(null, true)"
          (signedIn)="enter($event)"
          (startedOver)="startOver()"
        />
      </div>
    </main>
  `,
})
export default class AdminLoginPage {
  private readonly api = inject(AdminApiService);
  protected readonly session = inject(AdminSessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly step = signal<SignInStep>("credentials");

  protected startOver(): void {
    void this.api.logout().then(() => this.session.clear());
  }

  /**
   * Honour the `?r=` the guard attached, but never bounce outside /admin — and
   * never back to the login page itself, which would strand a signed-in admin
   * on the form they just completed.
   */
  protected async enter(user: AdminUser): Promise<void> {
    this.session.adopt(user, false);
    const requested = this.route.snapshot.queryParamMap.get("r");
    const target =
      requested?.startsWith("/admin") && !requested.startsWith("/admin/login")
        ? requested
        : "/admin";
    await this.router.navigateByUrl(target);
  }
}
