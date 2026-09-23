import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";

import { getContent, siteOriginOf } from "../utils/content-upstream";

/**
 * Served from a route so the Sitemap line points at the canonical host the
 * published SEO document declares, rather than a hardcoded domain that
 * silently rots if the site ever moves.
 */
export default defineEventHandler(async (event) => {
  const { payload } = await getContent("en");
  const origin = siteOriginOf(payload, getRequestURL(event).origin);

  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");

  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
});
