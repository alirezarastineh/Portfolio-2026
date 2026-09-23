import { inject } from "@angular/core";
import type { CanMatchFn, ResolveFn, Route } from "@angular/router";

import { LanguageService } from "../services/language.service";
import { ContentStore } from "./content.store";
import { isLocale } from "./locale";
import type { AppContent } from "./schema";

/**
 * Only real locales match `:locale`. Anything else (`/fr`, `/xyz`) falls
 * through to the root `[...not-found]` page, which answers 404.
 */
export const localeSegmentGuard: CanMatchFn = (_route, segments) => isLocale(segments[0]?.path);

/**
 * Puts `localeSegmentGuard` on the `:locale` route Analog generates from
 * `pages/[locale].page.ts`.
 *
 * It cannot live in that page's `routeMeta`: Analog applies `routeMeta` to an
 * empty-path child of `:locale`. A guard there fails for `/fr/x` as intended,
 * but for a bare `/fr` Angular still matches the parent — no URL is left for
 * a child to consume — and renders an empty page with status 200.
 */
export function guardLocaleRoute(fileRoutes: Route[]): void {
  const route = fileRoutes.find((r) => r.path === ":locale");
  if (!route) {
    throw new Error("[routing] no :locale route — was pages/[locale].page.ts renamed?");
  }
  route.canMatch = [localeSegmentGuard];
}

/**
 * Loads the locale's content, then makes it the active language. In that
 * order: activating first would re-render the visible page in a language
 * whose content has not arrived yet.
 *
 * Parent resolvers finish before child ones, so every page's title, meta and
 * head resolvers can rely on the content being there.
 */
export const localeContentResolver: ResolveFn<AppContent> = async (route) => {
  const locale = route.paramMap.get("locale");
  const store = inject(ContentStore);
  const language = inject(LanguageService);

  if (!isLocale(locale)) throw new Error(`unsupported locale "${locale}"`);

  const content = await store.ensure(locale);
  language.activate(locale);
  return content;
};
