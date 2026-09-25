import { HttpClient } from "@angular/common/http";
import { inject, Injectable, signal, type Signal, type WritableSignal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { CONTENT_SOURCE } from "./content-source";
import { appContentSchema, type AppContent, type Locale } from "./schema";

/**
 * Published content, one signal per locale.
 *
 * Starts empty on purpose: the bundled fallback lives only on the server now
 * (the Nitro BFF answers with it when the API is down), which keeps ~30 KB of
 * JSON out of the browser bundle. Every public page sits under the `[locale]`
 * route, whose resolver calls `ensure()` before anything renders — so a
 * component never sees an empty store.
 */
@Injectable({ providedIn: "root" })
export class ContentStore {
  private readonly http = inject(HttpClient);
  private readonly source = inject(CONTENT_SOURCE);

  private readonly state: Record<Locale, WritableSignal<AppContent | null>> = {
    en: signal<AppContent | null>(null),
    de: signal<AppContent | null>(null),
  };

  private readonly inFlight = new Map<Locale, Promise<AppContent>>();

  content(locale: Locale): Signal<AppContent | null> {
    return this.state[locale].asReadonly();
  }

  /**
   * Resolves once the locale's content is loaded, fetching it at most once.
   * Rejects only when there is nothing at all to show — the BFF falls back to
   * the bundled content itself, so that means the site's own server is down.
   *
   * The live source's URL is relative on purpose: it is identical on the
   * server and in the browser, which lets Angular's HTTP transfer cache replay
   * the SSR response during hydration instead of fetching again. During SSR,
   * Analog's `requestContextInterceptor` routes it through Nitro in-process.
   */
  ensure(locale: Locale): Promise<AppContent> {
    const loaded = this.state[locale]();
    if (loaded) return Promise.resolve(loaded);

    const existing = this.inFlight.get(locale);
    if (existing) return existing;

    const request = this.fetchLocale(locale).finally(() => this.inFlight.delete(locale));
    this.inFlight.set(locale, request);
    return request;
  }

  private async fetchLocale(locale: Locale): Promise<AppContent> {
    const raw = await firstValueFrom(this.http.get<unknown>(this.source.core(locale)));

    // Network data is never trusted blindly: a payload that does not match the
    // schema this build was made for is an error, not something to render.
    const parsed = appContentSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[content] invalid payload for "${locale}"`, parsed.error.issues);
      throw new Error(`invalid content payload for "${locale}"`);
    }

    this.state[locale].set(parsed.data);
    return parsed.data;
  }
}
