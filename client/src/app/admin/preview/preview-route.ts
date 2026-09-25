import { isPlatformBrowser } from "@angular/common";
import { inject, Injectable, PLATFORM_ID, signal } from "@angular/core";
import type { ResolveFn } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { firstValueFrom, isObservable } from "rxjs";

import { AdminApiService, type ApiIssue } from "../admin-api.service";
import { ContentStore } from "../../content/content.store";
import { CONTENT_PREVIEW, CONTENT_SOURCE, type ContentSource } from "../../content/content-source";
import { DocStore, statusOf } from "../../content/doc.store";
import { isLocale, type Locale } from "../../content/locale";
import { LanguageService } from "../../services/language.service";

/** Whether the draft loaded, and if not, why — for the preview's layout. */
@Injectable()
export class PreviewState {
  readonly locale = signal<Locale>("en");
  readonly ready = signal(false);
  /** The draft does not build: these are what publishing would refuse too. */
  readonly issues = signal<ApiIssue[]>([]);
  readonly error = signal<string | null>(null);
}

/** The admin API's draft endpoints: the same payloads a publish would write. */
function draftSource(): ContentSource {
  const base = inject(AdminApiService).baseUrl;
  return {
    core: (locale) => `${base}/admin/content/preview/${locale}`,
    doc: (locale, kind, slug) =>
      `${base}/admin/content/preview/${locale}/${kind}/${encodeURIComponent(slug)}`,
  };
}

/**
 * Everything the public pages read their content through, provided again for
 * the preview's routes: fresh instances whose source is the draft. The
 * language service is included because it holds the store it reads from.
 */
export const PREVIEW_PROVIDERS = [
  { provide: CONTENT_SOURCE, useFactory: draftSource },
  { provide: CONTENT_PREVIEW, useValue: true },
  ContentStore,
  DocStore,
  LanguageService,
  PreviewState,
];

function inBrowser(): boolean {
  return isPlatformBrowser(inject(PLATFORM_ID));
}

/**
 * Loads the draft for the locale and makes it the active language. Never
 * fails the navigation: a draft that does not build is shown as its problems.
 * On the server it does nothing — the session lives in the browser (see
 * `adminAuthGuard`), and the admin renders only a skeleton there.
 */
export const previewContentResolver: ResolveFn<boolean> = async (route) => {
  const state = inject(PreviewState);
  if (!inBrowser()) return false;
  // Everything injected before the first await: the injection context ends there.
  const store = inject(ContentStore);
  const language = inject(LanguageService);

  const locale = route.paramMap.get("locale");
  if (!isLocale(locale)) {
    state.error.set("unsupported_locale");
    return false;
  }
  state.locale.set(locale);

  try {
    await store.ensure(locale);
    language.activate(locale);
    state.ready.set(true);
    state.issues.set([]);
    state.error.set(null);
    return true;
  } catch (error) {
    state.ready.set(false);
    const body = (error as { error?: { error?: string; issues?: ApiIssue[] } }).error;
    state.issues.set(body?.issues ?? []);
    state.error.set(body?.error ?? `http_${statusOf(error) ?? "error"}`);
    if (!body?.error) console.error("[preview] could not load the draft", error);
    return false;
  }
};

type Meta = RouteMeta & {
  title?: string | ResolveFn<string>;
  meta?: unknown;
  resolve?: Record<string, ResolveFn<unknown>>;
};

/**
 * A public page's route metadata for the preview: its resolvers run only in
 * the browser and only once the draft has loaded (they read the content);
 * otherwise they stand down with a neutral value.
 */
export function previewMeta(meta: Meta): RouteMeta {
  const gated =
    <T>(fn: ResolveFn<T>, fallback: T): ResolveFn<T> =>
    (route, state) =>
      inBrowser() && inject(PreviewState).ready() ? fn(route, state) : fallback;

  const title = meta.title;
  return {
    ...meta,
    title:
      typeof title === "function"
        ? async (route, state) => {
            const res = gated(title, "Preview")(route, state);
            const resolved = isObservable(res) ? await firstValueFrom(res) : await res;
            const text = typeof resolved === "string" && resolved ? resolved : "Preview";
            return `Preview · ${text}`;
          }
        : `Preview · ${title ?? "draft"}`,
    ...(typeof meta.meta === "function"
      ? { meta: gated(meta.meta as ResolveFn<unknown>, []) }
      : {}),
    resolve: Object.fromEntries(
      Object.entries(meta.resolve ?? {}).map(([key, fn]) => [key, gated(fn, null)]),
    ),
  } as RouteMeta;
}
