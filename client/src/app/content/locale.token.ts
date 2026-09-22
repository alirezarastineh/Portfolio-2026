import { InjectionToken } from "@angular/core";

import { LOCALES, type Locale } from "./schema";

export const LOCALE_COOKIE = "portfolio-lang";
/** Legacy key, still read once so existing visitors keep their choice. */
export const LOCALE_STORAGE_KEY = "portfolio-lang";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function parseLocaleCookie(cookieHeader: string | undefined | null): Locale | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    if (isLocale(value)) return value;
  }
  return null;
}

/** `de-DE,de;q=0.9,en;q=0.8` → `de`. Only the top preference matters here. */
export function parseAcceptLanguage(header: string | undefined | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number.parseFloat(q.split("=")[1]) : 1 };
    })
    .filter((entry) => Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/**
 * The locale the app starts in. Overridden on the server from the request so
 * SSR HTML and the first client render agree; on the browser the default is
 * unused because `LanguageService` reads `document.cookie` directly.
 */
export const INITIAL_LOCALE = new InjectionToken<Locale>("INITIAL_LOCALE", {
  providedIn: "root",
  factory: () => "en",
});
