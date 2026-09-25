import { InjectionToken } from "@angular/core";

import type { DocKind, Locale } from "./schema";

/** Where `ContentStore` and `DocStore` fetch from. */
export interface ContentSource {
  core(locale: Locale): string;
  doc(locale: Locale, kind: DocKind, slug: string): string;
}

/**
 * The published content, through the site's own server (the BFF). Relative,
 * so a URL is the same on the server and in the browser — which is what lets
 * the HTTP transfer cache replay the server render's responses.
 */
export const LIVE_CONTENT: ContentSource = {
  core: (locale) => `/api/v2/content/${locale}`,
  doc: (locale, kind, slug) => `/api/v2/content/${locale}/${kind}/${slug}`,
};

/**
 * Replaced only by the admin's draft preview, which renders the same public
 * pages against the unpublished draft.
 */
export const CONTENT_SOURCE = new InjectionToken<ContentSource>("CONTENT_SOURCE", {
  providedIn: "root",
  factory: () => LIVE_CONTENT,
});

/**
 * True inside the draft preview. Checked where a public page would otherwise
 * act for real on a visitor's behalf (the assistant's live questions).
 */
export const CONTENT_PREVIEW = new InjectionToken<boolean>("CONTENT_PREVIEW", {
  providedIn: "root",
  factory: () => false,
});
