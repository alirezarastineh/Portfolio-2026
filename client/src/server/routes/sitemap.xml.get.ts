import { defineEventHandler, setResponseHeader } from "h3";

import fallbackEn from "../../app/content/fallback.en.json";

interface ContentShape {
  seo: { canonical: string };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Generated rather than static, so `lastmod` tracks the last publish instead of
 * whenever someone last hand-edited `public/sitemap.xml` (which said
 * 2026-05-05 regardless of reality).
 *
 * Both locales are served from the same URL — the language is chosen by cookie,
 * not by path — so there is exactly one entry and no hreflang alternates.
 */
export default defineEventHandler(async (event) => {
  let base = process.env["API_INTERNAL_BASE_URL"] ?? "";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  let canonical = (fallbackEn as unknown as ContentShape).seo.canonical;
  let lastmod = new Date();

  if (base) {
    try {
      const response = await fetch(`${base}/v1/content/en`, {
        signal: AbortSignal.timeout(2000),
        headers: { accept: "application/json" },
      });

      if (response.ok) {
        canonical = ((await response.json()) as ContentShape).seo.canonical;

        const published = response.headers.get("last-modified");
        if (published) {
          const parsed = new Date(published);
          if (!Number.isNaN(parsed.getTime())) lastmod = parsed;
        }
      }
    } catch {
      // A sitemap built from the bundled fallback beats a 500.
    }
  }

  setResponseHeader(event, "Content-Type", "application/xml; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(canonical)}</loc>
    <lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
});
