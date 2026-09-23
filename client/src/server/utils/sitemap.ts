import type { AppContent } from "../../app/content/schema";
import type { Locale } from "./content-upstream";
import { escapeXml } from "./xml";

const LOCALES: readonly Locale[] = ["en", "de"];

/** `YYYY-MM-DD` from any date string, or null — never "today", which would be a lie. */
export function isoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export interface SitemapPage {
  /** Path after `/{locale}`: "" for home, "/legal/imprint". */
  path: string;
  /** Per locale: when that version last changed; absent where the page does not exist. */
  lastmod: Partial<Record<Locale, string | null>>;
}

export type SitemapInput = Record<Locale, { content: AppContent; lastModified: string | null }>;

/** Adds `lastmod[locale]` to the page at `path`, creating the page on first sight. */
function mark(pages: Map<string, SitemapPage>, path: string, locale: Locale, when: string | null) {
  const page = pages.get(path) ?? { path, lastmod: {} };
  page.lastmod[locale] = isoDay(when);
  pages.set(path, page);
}

/**
 * Every public page and the languages it exists in: home, the legal pages,
 * each case study and post (only where written in that language), and the
 * writing index where there are posts. `lastmod` is when that version last
 * changed: the publish for home, the entity's own date otherwise.
 */
export function sitemapPages(byLocale: SitemapInput): SitemapPage[] {
  const pages = new Map<string, SitemapPage>();
  for (const locale of LOCALES) {
    const { content, lastModified } = byLocale[locale];
    mark(pages, "", locale, lastModified);
    for (const legal of content.legal ?? []) {
      mark(pages, `/legal/${legal.doc}`, locale, legal.updatedAt);
    }
    for (const project of content.projects ?? []) {
      if (project.hasCaseStudy) mark(pages, `/work/${project.slug}`, locale, project.updatedAt);
    }
    const posts = content.posts ?? [];
    if (posts.length > 0) {
      const dates = posts.map((p) => p.updatedAt).sort((a, b) => a.localeCompare(b));
      mark(pages, "/writing", locale, dates.at(-1) ?? null);
    }
    for (const post of posts) mark(pages, `/writing/${post.slug}`, locale, post.updatedAt);
  }
  return [...pages.values()];
}

/**
 * One `<url>` per page and language, each listing every language version
 * (itself included) plus `x-default`: search engines require hreflang to be
 * reciprocal.
 */
export function renderSitemap(pages: SitemapPage[], origin: string): string {
  const entries = pages.flatMap((page) => {
    const locales = LOCALES.filter((l) => l in page.lastmod);
    const xDefault = page.path ? `${origin}/${locales[0]}${page.path}` : `${origin}/`;
    const alternates = [
      ...locales.map((l) => {
        const href = escapeXml(`${origin}/${l}${page.path}`);
        return `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}" />`;
      }),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(xDefault)}" />`,
    ].join("\n");

    return locales.map((locale) => {
      const loc = escapeXml(`${origin}/${locale}${page.path}`);
      const lastmod = page.lastmod[locale];
      return [
        "  <url>",
        `    <loc>${loc}</loc>`,
        ...(lastmod ? [`    <lastmod>${lastmod}</lastmod>`] : []),
        alternates,
        "  </url>",
      ].join("\n");
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;
}
