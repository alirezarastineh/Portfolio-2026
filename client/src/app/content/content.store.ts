import { HttpClient } from "@angular/common/http";
import { inject, Injectable, signal, type Signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import fallbackDe from "./fallback.de.json";
import fallbackEn from "./fallback.en.json";
import { appContentSchema, type AppContent, type Locale } from "./schema";

/**
 * The bundled fallbacks are validated by `schema.spec.ts` at test time, so the
 * cast is checked — just not by the compiler, since a JSON import is untyped.
 */
const FALLBACK: Record<Locale, AppContent> = {
  en: fallbackEn as unknown as AppContent,
  de: fallbackDe as unknown as AppContent,
};

@Injectable({ providedIn: "root" })
export class ContentStore {
  private readonly http = inject(HttpClient);

  private readonly state: Record<Locale, ReturnType<typeof signal<AppContent>>> = {
    en: signal<AppContent>(FALLBACK.en),
    de: signal<AppContent>(FALLBACK.de),
  };

  private readonly resolved = new Set<Locale>();
  private readonly inFlight = new Map<Locale, Promise<void>>();

  /**
   * Always returns a usable payload. Seeded with the bundled fallback, so the
   * first render never has to deal with `undefined` and there is no flash of
   * empty content before the fetch lands.
   */
  content(locale: Locale): Signal<AppContent> {
    return this.state[locale].asReadonly();
  }

  hasResolved(locale: Locale): boolean {
    return this.resolved.has(locale);
  }

  /**
   * Relative URL on purpose: it is identical on the server and in the browser,
   * which is what lets Angular's HTTP transfer cache replay the SSR response on
   * hydration instead of re-fetching. During SSR Analog's
   * `requestContextInterceptor` routes it through Nitro's `$fetch`, so it never
   * leaves the process.
   */
  async load(locale: Locale): Promise<void> {
    const existing = this.inFlight.get(locale);
    if (existing) return existing;

    const request = this.fetchLocale(locale).finally(() => {
      this.inFlight.delete(locale);
    });

    this.inFlight.set(locale, request);
    return request;
  }

  private async fetchLocale(locale: Locale): Promise<void> {
    try {
      const raw = await firstValueFrom(
        this.http.get<unknown>(`/api/v1/content/${locale}`),
      );

      // Network data is never trusted: a schema mismatch keeps the last good
      // payload rather than rendering a half-broken page.
      const parsed = appContentSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`[content] invalid payload for "${locale}"`, parsed.error.issues);
        return;
      }

      this.state[locale].set(parsed.data);
      this.resolved.add(locale);
    } catch (error) {
      console.error(`[content] failed to load "${locale}", using fallback`, error);
    }
  }
}

export { LOCALES } from "./schema";
