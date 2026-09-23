import type { Locale } from "../content/locale";
import type { AppContent, PostDoc, Project, ProjectDoc } from "../content/schema";
import { absoluteImage, pageUrl } from "./seo-meta";

/**
 * JSON-LD for the pages below home (home's is `homeJsonLd` in seo-meta.ts).
 * Every graph points at the same `Person` node by id, so search engines tie
 * case studies and posts to the person the home page describes.
 */

export interface Crumb {
  name: string;
  url: string;
}

const CONTEXT = "https://schema.org";

function person(content: AppContent, locale: Locale, origin: string): object {
  return {
    "@type": "Person",
    "@id": `${origin}/#person`,
    name: content.identity.name,
    url: pageUrl(origin, locale),
  };
}

export function breadcrumbList(url: string, crumbs: Crumb[]): object {
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

function homeCrumb(content: AppContent, locale: Locale, origin: string): Crumb {
  return { name: content.identity.name, url: pageUrl(origin, locale) };
}

function writingCrumb(content: AppContent, locale: Locale, origin: string): Crumb {
  return { name: content.ui.writing.heading, url: pageUrl(origin, locale, "/writing") };
}

/** A case study: the project as a `CreativeWork` by the person. */
export function caseStudyJsonLd(
  content: AppContent,
  locale: Locale,
  origin: string,
  project: Project,
  doc: ProjectDoc,
): object {
  const url = pageUrl(origin, locale, `/work/${project.slug}`);
  const image = absoluteImage(origin, project.cover);
  const keywords = [...new Set([...project.tags, ...project.stack])];
  return {
    "@context": CONTEXT,
    "@graph": [
      {
        "@type": "CreativeWork",
        "@id": `${url}#work`,
        url,
        name: project.name,
        headline: project.name,
        description: doc.seo.description || project.hook || project.descriptor,
        inLanguage: locale,
        dateModified: doc.updatedAt,
        author: person(content, locale, origin),
        mainEntityOfPage: url,
        ...(image ? { image } : {}),
        ...(keywords.length ? { keywords: keywords.join(", ") } : {}),
        ...(project.period ? { dateCreated: project.period.start } : {}),
      },
      breadcrumbList(url, [homeCrumb(content, locale, origin), { name: project.name, url }]),
    ],
  };
}

/** The writing index: the locale's posts as a `Blog`. */
export function writingJsonLd(content: AppContent, locale: Locale, origin: string): object {
  const url = pageUrl(origin, locale, "/writing");
  return {
    "@context": CONTEXT,
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${url}#blog`,
        url,
        name: content.ui.writing.heading,
        description: content.ui.writing.subtitle,
        inLanguage: locale,
        author: person(content, locale, origin),
        blogPost: content.posts.map((post) => ({
          "@type": "BlogPosting",
          headline: post.title,
          url: pageUrl(origin, locale, `/writing/${post.slug}`),
          datePublished: post.publishedAt,
          dateModified: post.updatedAt,
        })),
      },
      breadcrumbList(url, [
        homeCrumb(content, locale, origin),
        writingCrumb(content, locale, origin),
      ]),
    ],
  };
}

/** A post as a `BlogPosting`, part of the locale's `Blog`. */
export function postJsonLd(
  content: AppContent,
  locale: Locale,
  origin: string,
  post: PostDoc,
): object {
  const url = pageUrl(origin, locale, `/writing/${post.slug}`);
  const image = absoluteImage(origin, post.cover);
  return {
    "@context": CONTEXT,
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${url}#post`,
        url,
        mainEntityOfPage: url,
        headline: post.title,
        description: post.seo.description || post.excerpt,
        inLanguage: locale,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt,
        author: person(content, locale, origin),
        isPartOf: { "@id": `${pageUrl(origin, locale, "/writing")}#blog` },
        ...(image ? { image } : {}),
        ...(post.tags.length ? { keywords: post.tags.join(", ") } : {}),
      },
      breadcrumbList(url, [
        homeCrumb(content, locale, origin),
        writingCrumb(content, locale, origin),
        { name: post.title, url },
      ]),
    ],
  };
}
