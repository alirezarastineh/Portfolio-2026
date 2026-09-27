import { isPlatformBrowser } from "@angular/common";
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";

import { clockTime } from "../content/place";
import { LanguageService } from "./language.service";

/**
 * The reader's "now", to the minute, for the local times the site shows (the
 * hero's status line, the contact section): one timer for all of them, started
 * by the first to render in the browser. The server has no time to give, so
 * its HTML and the hydrated page agree, and the clock fills in after.
 */
@Injectable({ providedIn: "root" })
export class ClockService {
  private readonly lang = inject(LanguageService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly now = signal<Date | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  /** Starts the clock, ticking on the minute; once started, a no-op. */
  start(): void {
    if (!this.isBrowser || this.timer !== undefined) return;
    const tick = () => {
      const now = new Date();
      this.now.set(now);
      this.timer = setTimeout(tick, 60_000 - (now.getTime() % 60_000));
    };
    tick();
  }

  /** The time in `timeZone`, `14:32`; empty until the clock starts, and on the server. */
  time(timeZone: string): string {
    const now = this.now();
    return now ? clockTime(timeZone, this.lang.lang(), now) : "";
  }
}
