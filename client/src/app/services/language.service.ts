import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, type UrlTree } from "@angular/router";
import { filter, map } from "rxjs";

import { ContentStore } from "../content/content.store";
import {
  DEFAULT_LOCALE,
  LOCALES,
  localeCookie,
  pageKey,
  swapLocale,
  type Locale,
} from "../content/locale";
import type { AppContent, AppTranslations } from "../content/schema";

/**
 * The active language. The URL decides it: `/de/...` is German, and the
 * `[locale]` route's resolver calls `activate()` once that locale's content has
 * loaded. So the server render, the hydrated page and a shared link always
 * agree, and switching language is an ordinary navigation.
 */
@Injectable({ providedIn: "root" })
export class LanguageService {
  private readonly store = inject(ContentStore);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly _lang = signal<Locale>(DEFAULT_LOCALE);
  readonly lang = this._lang.asReadonly();

  /**
   * Structural content — socials, skills, projects, SEO, identity. Only read
   * under the `[locale]` route, whose resolver loads it first; reading it
   * anywhere else is a bug, and says so.
   */
  readonly content = computed<AppContent>(() => {
    const content = this.store.content(this._lang())();
    if (!content) {
      throw new Error(`[i18n] "${this._lang()}" content read before the locale route loaded it`);
    }
    return content;
  });

  /** The localized copy tree every template reads through `lang.t().some.path`. */
  readonly t = computed<AppTranslations>(() => this.content().ui);

  /** The current URL as a signal, so links derived from it stay current in OnPush views. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The current page without its language: `/` for home, `/legal/imprint`, … */
  readonly page = computed(() => pageKey(this.url()));

  /** This page in each language — what the language switch links to. */
  readonly alternates = computed<Record<Locale, UrlTree>>(() => {
    const url = this.url();
    return Object.fromEntries(
      LOCALES.map((locale) => [locale, this.router.parseUrl(swapLocale(url, locale))]),
    ) as Record<Locale, UrlTree>;
  });

  /** Called by the locale route's resolver once the content is loaded. */
  activate(locale: Locale): void {
    this._lang.set(locale);
  }

  /**
   * Remembers an explicit choice, so a later visit to `/` lands in the same
   * language. The URL, not this cookie, decides what a page renders.
   */
  remember(locale: Locale): void {
    if (!this.isBrowser) return;
    try {
      document.cookie = localeCookie(locale);
    } catch {
      // Cookies may be blocked; the choice then lasts as long as the URL does.
    }
  }

  /**
   * Content links such as `#projects` point at the home page's sections. With
   * `<base href="/">` a bare fragment would resolve to `/#projects` and reload
   * the site, so they become `/en#projects`.
   */
  homeHref(href: string): string {
    return href.startsWith("#") ? `/${this._lang()}${href}` : href;
  }
}
