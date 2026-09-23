import { DOCUMENT } from "@angular/common";
import { inject } from "@angular/core";
import type { ResolveFn } from "@angular/router";
import type { MetaTag } from "@analogjs/router";

import { LOCALES, OG_LOCALE, otherLocale, type Locale } from "../content/locale";
import type { Alternates, AppContent, Image } from "../content/schema";
import { LanguageService } from "../services/language.service";
import { applyHead } from "./head";

const FALLBACK_ORIGIN = "https://alirezarastineh.me";

/** The site's origin: the profile's site URL, else the SEO document's canonical URL. */
export function siteOrigin(content: AppContent): string {
  for (const candidate of [content.identity.siteUrl, content.seo.canonical]) {
    try {
      if (candidate) return new URL(candidate).origin;
    } catch {
      // try the next one
    }
  }
  return FALLBACK_ORIGIN;
}

/** `https://…/en` for home, `https://…/en/legal/imprint` for a subpage. */
export function pageUrl(origin: string, locale: Locale, path = ""): string {
  return `${origin}/${locale}${path}`;
}

/**
 * The page in every language, plus `x-default` for visitors in neither.
 * Every language version lists all of them, itself included — hreflang must
 * be reciprocal or search engines ignore it.
 */
export function languageAlternates(
  origin: string,
  path: string,
  xDefault: string,
): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const locale of LOCALES) alternates[locale] = pageUrl(origin, locale, path);
  alternates["x-default"] = xDefault;
  return alternates;
}

/**
 * hreflang for a page that exists in only some languages — a case study or a
 * post, whose `alternates` are null where there is no version. `x-default` is
 * the English version when there is one.
 */
export function docLanguageAlternates(
  origin: string,
  alternates: Alternates,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of LOCALES) {
    const path = alternates[locale];
    if (path) out[locale] = `${origin}${path}`;
  }
  const xDefault = out["en"] ?? Object.values(out)[0];
  if (xDefault) out["x-default"] = xDefault;
  return out;
}

/**
 * An image as an absolute URL for social cards and structured data, or null
 * when there is none a card can show — the legacy SVG placeholders are not.
 */
export function absoluteImage(origin: string, image: Image | null | undefined): string | null {
  if (!image || /\.svg$/i.test(image.src)) return null;
  return /^https?:\/\//i.test(image.src) ? image.src : `${origin}${image.src}`;
}

/**
 * The generated social card of a case study or post (1200×630 PNG, drawn by
 * the server from the published content: src/server/routes/[locale]/og).
 */
export function socialCard(
  origin: string,
  locale: Locale,
  kind: "work" | "writing",
  slug: string,
): string {
  return pageUrl(origin, locale, `/og/${kind}/${slug}.png`);
}

/** The locale's RSS feed, when it has posts to put in one. */
export function feedsOf(content: AppContent, locale: Locale): { title: string; href: string }[] {
  if (content.posts.length === 0) return [];
  return [
    {
      title: `${content.ui.writing.heading} · ${content.identity.name}`,
      href: pageUrl(siteOrigin(content), locale, "/rss.xml"),
    },
  ];
}

interface PageMeta {
  title: string;
  description: string;
  url: string;
  robots: string;
  /** `article` for a post; everything else is `website`. */
  ogType?: "website" | "article";
  /** Absolute URL of the page's own card image; the site's default otherwise. */
  image?: string | null;
  imageAlt?: string;
  /** Social cards default to the page title and description. */
  ogTitle?: string;
  ogDescription?: string;
  twitterTitle?: string;
  twitterDescription?: string;
}

/**
 * The full set of tags for one page. Every page emits all of them: Analog
 * updates tags by name on navigation but never removes one, so a tag a page
 * left out would keep the previous page's value.
 */
export function pageMeta(content: AppContent, locale: Locale, page: PageMeta): MetaTag[] {
  const seo = content.seo;
  return [
    { name: "description", content: page.description },
    { name: "robots", content: page.robots },
    { name: "author", content: seo.author },
    { name: "theme-color", content: seo.themeColor },
    { property: "og:type", content: page.ogType ?? "website" },
    { property: "og:site_name", content: seo.siteName },
    { property: "og:title", content: page.ogTitle ?? page.title },
    { property: "og:description", content: page.ogDescription ?? page.description },
    { property: "og:url", content: page.url },
    { property: "og:image", content: page.image ?? seo.ogImage },
    {
      property: "og:image:alt",
      content: (page.image && page.imageAlt) || page.ogTitle || page.title,
    },
    { property: "og:locale", content: seo.ogLocale || OG_LOCALE[locale] },
    { property: "og:locale:alternate", content: OG_LOCALE[otherLocale(locale)] },
    { name: "twitter:card", content: seo.twitterCard },
    { name: "twitter:title", content: page.twitterTitle ?? page.title },
    { name: "twitter:description", content: page.twitterDescription ?? page.description },
    { name: "twitter:image", content: page.image ?? seo.twitterImage },
  ];
}

/**
 * Structured data for the home page: the person, the site, and the page that
 * is the person's profile — Google's `ProfilePage` type for exactly this.
 */
export function homeJsonLd(content: AppContent, locale: Locale, origin: string): object {
  const personId = `${origin}/#person`;
  const websiteId = `${origin}/#website`;
  const url = pageUrl(origin, locale);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${url}#page`,
        url,
        name: content.seo.title,
        description: content.seo.description,
        inLanguage: locale,
        isPartOf: { "@id": websiteId },
        mainEntity: { "@id": personId },
      },
      {
        "@type": "Person",
        "@id": personId,
        name: content.identity.name,
        alternateName: content.identity.handle,
        url,
        jobTitle: content.ui.profile.role,
        email: `mailto:${content.identity.contactEmail}`,
        sameAs: content.socials.map((s) => s.href).filter((href) => /^https?:\/\//i.test(href)),
        knowsAbout: [...new Set(content.skills.flatMap((s) => s.items))].slice(0, 30),
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: `${origin}/`,
        name: content.seo.siteName,
        inLanguage: [...LOCALES],
        publisher: { "@id": personId },
      },
    ],
  };
}

export const homeTitleResolver: ResolveFn<string> = () =>
  inject(LanguageService).content().seo.title;

export const homeMetaResolver: ResolveFn<MetaTag[]> = () => {
  const lang = inject(LanguageService);
  const content = lang.content();
  const seo = content.seo;

  return pageMeta(content, lang.lang(), {
    title: seo.title,
    description: seo.description,
    url: pageUrl(siteOrigin(content), lang.lang()),
    robots: "index, follow",
    ogTitle: seo.ogTitle,
    ogDescription: seo.ogDescription,
    twitterTitle: seo.twitterTitle,
    twitterDescription: seo.twitterDescription,
  });
};

/** `x-default` is `/`, which sends each visitor to their own language. */
export const homeHeadResolver: ResolveFn<true> = () => {
  const lang = inject(LanguageService);
  const content = lang.content();
  const origin = siteOrigin(content);

  applyHead(inject(DOCUMENT), {
    canonical: pageUrl(origin, lang.lang()),
    alternates: languageAlternates(origin, "", `${origin}/`),
    jsonLd: homeJsonLd(content, lang.lang(), origin),
    feeds: feedsOf(content, lang.lang()),
  });
  return true;
};
