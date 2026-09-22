import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";

import { AdminApiService, type AdminUser } from "./admin-api.service";

@Injectable({ providedIn: "root" })
export class AdminSessionService {
  private readonly api = inject(AdminApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _user = signal<AdminUser | null>(null);
  private readonly _pendingTotp = signal(false);
  private readonly _checked = signal(false);
  private inFlight: Promise<boolean> | null = null;

  readonly user = this._user.asReadonly();
  readonly pendingTotp = this._pendingTotp.asReadonly();
  readonly checked = this._checked.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null && !this._pendingTotp());

  /**
   * Resolves the session once and caches the result. The guard awaits this, so
   * it must never throw — a failure is simply "not authenticated".
   */
  async ensure(force = false): Promise<boolean> {
    // The session cookie lives on the API origin, which SSR cannot read.
    if (!this.isBrowser) return false;
    if (this._checked() && !force) return this.isAuthenticated();
    if (this.inFlight && !force) return this.inFlight;

    this.inFlight = this.refresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async refresh(): Promise<boolean> {
    const result = await this.api.me();

    if (result.ok) {
      this._user.set(result.data.user);
      this._pendingTotp.set(result.data.pendingTotp);
    } else {
      this._user.set(null);
      this._pendingTotp.set(false);
    }

    this._checked.set(true);
    return this.isAuthenticated();
  }

  /** Called by the login flow once credentials are accepted. */
  adopt(user: AdminUser | null, pendingTotp: boolean): void {
    this._user.set(user);
    this._pendingTotp.set(pendingTotp);
    this._checked.set(true);
  }

  /** Called by the interceptor on a 401, and after an explicit logout. */
  clear(): void {
    this._user.set(null);
    this._pendingTotp.set(false);
    this._checked.set(true);
  }
}
