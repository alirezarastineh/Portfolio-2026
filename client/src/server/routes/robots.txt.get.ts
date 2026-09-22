import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";

import fallbackEn from "../../app/content/fallback.en.json";

interface ContentShape {
  seo: { canonical: string };
}

/**
 * Served from a route so the Sitemap line always points at the canonical host
 * the SEO document declares, rather than a hardcoded domain that silently rots
 * if the site ever moves.
 */
export default defineEventHandler((event) => {
  const canonical = (fallbackEn as unknown as ContentShape).seo.canonical;

  let origin: string;
  try {
    origin = new URL(canonical).origin;
  } catch {
    origin = getRequestURL(event).origin;
  }

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");

  return `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${origin}/sitemap.xml
`;
});
