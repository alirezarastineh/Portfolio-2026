import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";

import { ContentStore } from "../content/content.store";
import {
  INITIAL_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  isLocale,
  parseLocaleCookie,
} from "../content/locale.token";
import type { AppContent, AppTranslations, Locale } from "../content/schema";

const COOKIE_MAX_AGE = 31_536_000; // one year

@Injectable({ providedIn: "root" })
export class LanguageService {
  private readonly platform = inject(PLATFORM_ID);
  private readonly store = inject(ContentStore);
  private readonly initialLocale = inject(INITIAL_LOCALE);
  private readonly _lang = signal<Locale>(this.getInitial());

  readonly lang = this._lang.asReadonly();

  /**
   * The keystone. Every template reads copy through `lang.t().some.path`, so
   * swapping the backing store from static imports to DB-fed signals needed no
   * template changes at all.
   */
  readonly t = computed<AppTranslations>(() => this.store.content(this._lang())().ui);

  /** Structural content — socials, skills, projects, SEO, identity. */
  readonly content = computed<AppContent>(() => this.store.content(this._lang())());

  toggle(): void {
    void this.setLang(this._lang() === "en" ? "de" : "en");
  }

  async setLang(next: Locale): Promise<void> {
    if (next === this._lang()) return;

    // Fetch before switching so the UI never flashes the other locale's
    // fallback; the current locale stays on screen until the new one lands.
    if (!this.store.hasResolved(next)) {
      await this.store.load(next);
    }

    this._lang.set(next);
    this.persist(next);
  }

  private persist(next: Locale): void {
    if (!isPlatformBrowser(this.platform)) return;

    try {
      // The cookie is what SSR reads, so it is the authoritative store.
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch {
      // Ignore cookie errors
    }
    try {
      localStorage?.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
    // `<html lang>` is handled by an effect in App, so it stays correct for
    // server renders too rather than only after a client-side toggle.
  }

  private getInitial(): Locale {
    // On the server this token carries the locale negotiated from the request.
    if (!isPlatformBrowser(this.platform)) return this.initialLocale;

    const fromCookie = parseLocaleCookie(
      typeof document === "undefined" ? null : document.cookie,
    );
    if (fromCookie) return fromCookie;

    // No cookie yet: SSR already negotiated one for this render, so trust it
    // over localStorage to keep the server and client markup in agreement.
    if (isLocale(this.initialLocale)) return this.initialLocale;

    try {
      const stored = localStorage?.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored)) return stored;
    } catch {
      // Ignore storage errors
    }

    return "en";
  }
}
