import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { AdminApiService, type AdminUser } from "../../admin/admin-api.service";
import { AdminSessionService } from "../../admin/admin-session.service";
import {
  SignInFormComponent,
  type SignInStep,
} from "../../admin/components/sign-in-form.component";
import { TerminalWindowComponent } from "../../admin/components/terminal-window.component";

@Component({
  selector: "app-admin-login",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SignInFormComponent, TerminalWindowComponent],
  host: { class: "block" },
  // A wrong password shakes the window, once, as a terminal bell would sound.
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .shake {
        animation: shake 360ms var(--ease-out, ease-out);
      }
    }

    @keyframes shake {
      20% {
        translate: -6px 0;
      }
      40% {
        translate: 6px 0;
      }
      60% {
        translate: -4px 0;
      }
      80% {
        translate: 2px 0;
      }
    }
  `,
  template: `
    <main class="relative isolate flex min-h-screen items-center justify-center px-6 py-12">
      <!-- The hero's dot grid, drawn in CSS: the canvas that bends it lives in the home
           page's own chunk, and sharing it would cost every visitor a request. -->
      <div
        class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle,var(--accent-indigo)_1px,transparent_1.5px)] bg-size-[22px_22px] bg-center opacity-30 mask-[radial-gradient(ellipse_65%_60%_at_50%_45%,#000_20%,transparent_75%)]"
        aria-hidden="true"
      ></div>

      <div class="w-full max-w-sm" [class.shake]="shake()" (animationend)="shake.set(false)">
        <app-terminal-window [title]="windowTitle()">
          <div class="flex flex-col gap-5">
            <div>
              <p class="m-0 text-muted-foreground" aria-hidden="true">
                <span class="text-accent-orange">~$</span>
                {{ step() === "credentials" ? "sudo login" : "verify --totp" }}
              </p>
              <h1 class="m-0 mt-3 font-sans text-page-title text-foreground">
                {{ step() === "credentials" ? "admin" : "two-factor" }}
              </h1>
              <p class="m-0 mt-1 font-sans text-sm text-muted-foreground">
                {{
                  step() === "credentials"
                    ? "Sign in to edit site content."
                    : "Enter the 6-digit code from your authenticator, or a recovery code."
                }}
              </p>
            </div>

            <div class="font-sans">
              <app-sign-in-form
                [(step)]="step"
                (codeNeeded)="session.adopt(null, true)"
                (signedIn)="enter($event)"
                (refused)="shake.set(true)"
                (startedOver)="startOver()"
              />
            </div>
          </div>
        </app-terminal-window>
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
  /** Set by a refused attempt; the animation's end clears it for the next one. */
  protected readonly shake = signal(false);

  protected readonly windowTitle = computed(() =>
    this.step() === "credentials" ? "admin@portfolio — login" : "admin@portfolio — two-factor",
  );

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
