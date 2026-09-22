import { inject } from "@angular/core";
import type { ResolveFn } from "@angular/router";
import type { MetaTag } from "@analogjs/router";

import { LanguageService } from "../services/language.service";

/**
 * Builds the page's meta tags from the published `seo` document.
 *
 * Analog turns a function-valued `routeMeta.meta` into a route resolver, and
 * applies the result with Angular's `Meta.updateTag`, which matches on the
 * name/property selector — so these overwrite the static tags in `index.html`
 * rather than duplicating them. The static ones stay as a sensible fallback for
 * the brief moment before hydration.
 */
export const seoMetaResolver: ResolveFn<MetaTag[]> = () => {
  const lang = inject(LanguageService);
  const seo = lang.content().seo;

  return [
    { name: "description", content: seo.description },
    { name: "author", content: seo.author },
    { name: "theme-color", content: seo.themeColor },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: seo.siteName },
    { property: "og:title", content: seo.ogTitle },
    { property: "og:description", content: seo.ogDescription },
    { property: "og:url", content: seo.ogUrl },
    { property: "og:image", content: seo.ogImage },
    { property: "og:locale", content: seo.ogLocale },
    { name: "twitter:card", content: seo.twitterCard },
    { name: "twitter:title", content: seo.twitterTitle },
    { name: "twitter:description", content: seo.twitterDescription },
    { name: "twitter:image", content: seo.twitterImage },
  ];
};

export const seoTitleResolver: ResolveFn<string> = () =>
  inject(LanguageService).content().seo.title;

/**
 * `Meta` only manages `<meta>`, so the canonical `<link>` is set by hand. Kept
 * DOM-level rather than templated because it lives in `<head>`, outside the
 * component tree — and it must be right during SSR, not only after hydration.
 * The document is passed in: this is called from an effect, which runs outside
 * an injection context on every run after the first.
 */
export function applyCanonical(document: Document, href: string): void {
  const head = document.head;
  if (!head) return;

  let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    head.appendChild(link);
  }
  link.setAttribute("href", href);
}
