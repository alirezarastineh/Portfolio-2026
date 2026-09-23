import { defineEventHandler, setResponseHeader } from "h3";

import type { AppContent } from "../../app/content/schema";
import { getContent, LOCALES, siteOriginOf, type Locale } from "../utils/content-upstream";

const FALLBACK_ORIGIN = "https://alirezarastineh.me";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `YYYY-MM-DD` from any date string, or null — never "today", which would be a lie. */
function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

interface Page {
  /** Path after `/{locale}`: "" for home, "/legal/imprint". */
  path: string;
  /** Per locale: when that version last changed; absent where the page does not exist. */
  lastmod: Partial<Record<Locale, string | null>>;
}

function buildSitemapPages(
  byLocale: Record<Locale, { payload: unknown; lastModified: string | null }>,
): Page[] {
  const pages: Page[] = [
    {
      path: "",
      lastmod: Object.fromEntries(LOCALES.map((l) => [l, isoDay(byLocale[l].lastModified)])),
    },
  ];
  for (const doc of ["imprint", "privacy"] as const) {
    const lastmod: Page["lastmod"] = {};
    for (const locale of LOCALES) {
      const legal = (byLocale[locale].payload as AppContent).legal?.find((l) => l.doc === doc);
      if (legal) lastmod[locale] = isoDay(legal.updatedAt);
    }
    if (Object.keys(lastmod).length > 0) pages.push({ path: `/legal/${doc}`, lastmod });
  }
  return pages;
}

function renderPageEntries(page: Page, origin: string): string[] {
  const locales = LOCALES.filter((l) => l in page.lastmod);
  const xDefaultHref = page.path ? `${origin}/${locales[0]}${page.path}` : `${origin}/`;
  const alternates = [
    ...locales.map((l) => {
      const href = `${origin}/${l}${page.path}`;
      return `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeXml(href)}" />`;
    }),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xDefaultHref)}" />`,
  ].join("\n");

  return locales.map((locale) => {
    const lastmod = page.lastmod[locale];
    const loc = `${origin}/${locale}${page.path}`;
    return [
      "  <url>",
      `    <loc>${escapeXml(loc)}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
      alternates,
      "  </url>",
    ].join("\n");
  });
}

/**
 * One `<url>` per page and language, each listing every language version
 * (itself included) plus `x-default`, as search engines require hreflang to
 * be reciprocal. `lastmod` is when that page last changed: the publish for
 * home, the document's own date for a legal page.
 */
export default defineEventHandler(async (event) => {
  const results = await Promise.all(LOCALES.map((locale) => getContent(locale)));
  const byLocale = Object.fromEntries(LOCALES.map((l, i) => [l, results[i]!])) as Record<
    Locale,
    (typeof results)[number]
  >;
  const origin = siteOriginOf(byLocale.en.payload, FALLBACK_ORIGIN);

  const pages = buildSitemapPages(byLocale);
  const entries = pages.flatMap((page) => renderPageEntries(page, origin));

  setResponseHeader(event, "Content-Type", "application/xml; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
});
