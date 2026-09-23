import { defineEventHandler, setResponseHeader } from "h3";

import type { AppContent } from "../../app/content/schema";
import { getContent, LOCALES, siteOriginOf } from "../utils/content-upstream";
import { renderSitemap, sitemapPages, type SitemapInput } from "../utils/sitemap";

const FALLBACK_ORIGIN = "https://alirezarastineh.me";

/** Every public page in every language it exists in, with reciprocal alternates. */
export default defineEventHandler(async (event) => {
  const results = await Promise.all(LOCALES.map((locale) => getContent(locale)));
  const byLocale = Object.fromEntries(
    LOCALES.map((l, i) => [
      l,
      { content: results[i]!.payload as AppContent, lastModified: results[i]!.lastModified },
    ]),
  ) as SitemapInput;
  const origin = siteOriginOf(results[0]!.payload, FALLBACK_ORIGIN);

  setResponseHeader(event, "Content-Type", "application/xml; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");
  return renderSitemap(sitemapPages(byLocale), origin);
});
