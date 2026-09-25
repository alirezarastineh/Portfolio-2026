import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { CONTENT_SOURCE } from "./content-source";
import { docSchema, type Doc, type DocKind, type Locale } from "./schema";

/**
 * The HTTP status of a failed request. In the browser that is Angular's
 * `HttpErrorResponse`; during SSR, Analog's `requestContextInterceptor` calls
 * Nitro in-process with ofetch, which rejects with its own `FetchError`.
 */
export function statusOf(error: unknown): number | null {
  if (error instanceof HttpErrorResponse) return error.status;
  const { status, statusCode } = (error ?? {}) as { status?: unknown; statusCode?: unknown };
  if (typeof status === "number") return status;
  return typeof statusCode === "number" ? statusCode : null;
}

/**
 * The long-form bodies — a case study, a post, a legal page — fetched per page
 * rather than shipped in the core every page loads.
 *
 * Keyed by URL and kept for the session: a doc changes only with a publish,
 * which a visitor's open tab would not see anyway. Relative URLs, so the SSR
 * response is replayed from Angular's transfer cache during hydration.
 */
@Injectable({ providedIn: "root" })
export class DocStore {
  private readonly http = inject(HttpClient);
  private readonly source = inject(CONTENT_SOURCE);
  private readonly loaded = new Map<string, Doc | null>();
  private readonly inFlight = new Map<string, Promise<Doc | null>>();

  /** The doc, or null when this locale has none by that slug. Rejects only on a real failure. */
  ensure(locale: Locale, kind: DocKind, slug: string): Promise<Doc | null> {
    const url = this.source.doc(locale, kind, slug);
    if (this.loaded.has(url)) return Promise.resolve(this.loaded.get(url) ?? null);

    const existing = this.inFlight.get(url);
    if (existing) return existing;

    const request = this.fetch(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, request);
    return request;
  }

  private async fetch(url: string): Promise<Doc | null> {
    let raw: unknown;
    try {
      raw = await firstValueFrom(this.http.get<unknown>(url));
    } catch (error) {
      if (statusOf(error) === 404) {
        this.loaded.set(url, null);
        return null;
      }
      throw error;
    }

    const parsed = docSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[content] invalid doc at ${url}`, parsed.error.issues);
      throw new Error(`invalid doc at ${url}`);
    }
    this.loaded.set(url, parsed.data);
    return parsed.data;
  }
}
