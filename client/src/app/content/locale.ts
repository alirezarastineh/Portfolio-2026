/**
 * Framework-free locale helpers, shared by the Angular app and the Nitro
 * server (the `/` redirect middleware), so both negotiate the same way.
 *
 * This file imports nothing: vite.config.ts loads it too, and Vite's native
 * config loader (Node's type stripping) needs every relative import to name
 * its `.ts` file, which the app's compiler does not accept. So the list below
 * is not taken from `./schema`; `locale.spec.ts` keeps the two equal.
 */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "portfolio-lang";
export const LOCALE_COOKIE_MAX_AGE = 31_536_000; // one year

/** `og:locale` values; the other locale's goes into `og:locale:alternate`. */
export const OG_LOCALE: Record<Locale, string> = { en: "en_US", de: "de_DE" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "de" : "en";
}

export function parseLocaleCookie(cookieHeader: string | undefined | null): Locale | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LOCALE_COOKIE) continue;
    try {
      const value = decodeURIComponent(rest.join("="));
      if (isLocale(value)) return value;
    } catch {
      // A malformed cookie is simply not a preference.
    }
  }
  return null;
}

/** `de-DE,de;q=0.9,en;q=0.8` → `de`. The highest-ranked supported language wins. */
export function parseAcceptLanguage(header: string | undefined | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number.parseFloat(q.split("=")[1] ?? "") : 1 };
    })
    .filter((entry) => Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** An explicit choice (the cookie) beats the browser's languages, which beat the default. */
export function negotiateLocale(
  cookieHeader: string | undefined | null,
  acceptLanguage: string | undefined | null,
): Locale {
  return parseLocaleCookie(cookieHeader) ?? parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

const LOCALE_PREFIX = /^\/(en|de)(?=[/?#]|$)/;

/** The locale a path starts with (`/de/legal/imprint` → `de`), if any. */
export function localeOfPath(path: string): Locale | null {
  const match = LOCALE_PREFIX.exec(path);
  return match ? (match[1] as Locale) : null;
}

/**
 * The same page in another language: `/en/legal/imprint#x` → `/de/legal/imprint#x`.
 * A URL without a locale prefix maps to that locale's home page.
 */
export function swapLocale(url: string, locale: Locale): string {
  return LOCALE_PREFIX.test(url) ? url.replace(LOCALE_PREFIX, `/${locale}`) : `/${locale}`;
}

/**
 * Where the language switch leads from a page that may not exist in every
 * language (a case study, a post): its own version where there is one,
 * `fallback(locale)` — an index page — where there is not.
 */
export function switchTargets(
  alternates: Partial<Record<Locale, string | null>>,
  fallback: (locale: Locale) => string,
): Record<Locale, string> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, alternates[locale] ?? fallback(locale)]),
  ) as Record<Locale, string>;
}

/** The page a URL shows, independent of its language: `/de/legal/imprint?x#y` → `/legal/imprint`. */
export function pageKey(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return path.replace(LOCALE_PREFIX, "") || "/";
}

export interface LocaleRedirect {
  status: 301 | 302;
  location: string;
  /** True when the target depends on the request's cookie and languages. */
  negotiated: boolean;
}

/**
 * Where a request should be redirected before rendering, or null to render it.
 *
 * - `/` → the visitor's language (302: it differs per visitor).
 * - `/EN`, `/de/` and `/de/legal/imprint/` → their canonical spelling (301).
 * - Routes that no longer exist → home (301).
 */
export function localeRedirect(
  pathWithQuery: string,
  cookieHeader: string | undefined | null,
  acceptLanguage: string | undefined | null,
): LocaleRedirect | null {
  const queryStart = pathWithQuery.indexOf("?");
  const path = queryStart === -1 ? pathWithQuery : pathWithQuery.slice(0, queryStart);
  const query = queryStart === -1 ? "" : pathWithQuery.slice(queryStart);

  if (path === "/") {
    return {
      status: 302,
      location: `/${negotiateLocale(cookieHeader, acceptLanguage)}${query}`,
      negotiated: true,
    };
  }

  if (path === "/sandbox" || path === "/sandbox/") {
    return { status: 301, location: "/", negotiated: false };
  }

  const match = /^\/(en|de)(\/.*)?$/i.exec(path);
  if (!match) return null;

  const locale = match[1]!.toLowerCase();
  let rest = match[2] ?? "";
  while (rest.endsWith("/")) {
    rest = rest.slice(0, -1);
  }
  const canonical = `/${locale}${rest}`;
  return canonical === path
    ? null
    : { status: 301, location: `${canonical}${query}`, negotiated: false };
}
