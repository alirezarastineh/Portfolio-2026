import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  appContentSchema,
  type AppContent,
  type Locale,
  type PostSummary,
} from "../../app/content/schema";
import { buildRss } from "./rss";
import { renderSitemap, sitemapPages } from "./sitemap";

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://example.test";

function fallback(locale: Locale): AppContent {
  const raw = readFileSync(resolve(here, `../../app/content/fallback.${locale}.json`), "utf8");
  return appContentSchema.parse(JSON.parse(raw));
}

function post(slug: string, over: Partial<PostSummary> = {}): PostSummary {
  return {
    slug,
    title: `Post ${slug}`,
    excerpt: "An excerpt with <tags> & ampersands",
    publishedAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-02T09:00:00.000Z",
    tags: ["ai"],
    cover: null,
    readingMinutes: 4,
    alternates: { en: `/en/writing/${slug}`, de: null },
    ...over,
  };
}

describe("buildRss", () => {
  it("lists each post with an absolute link, an RFC 822 date and the escaped excerpt", () => {
    const content = {
      ...fallback("en"),
      posts: [post("b", { updatedAt: "2026-09-01T00:00:00.000Z" }), post("a")],
    };
    const xml = buildRss(content, ORIGIN);

    expect(xml).toContain(`<atom:link href="${ORIGIN}/en/rss.xml" rel="self"`);
    expect(xml).toContain(`<link>${ORIGIN}/en/writing</link>`);
    expect(xml).toContain("<language>en</language>");
    expect(xml).toContain(`<guid isPermaLink="true">${ORIGIN}/en/writing/b</guid>`);
    expect(xml).toContain("<pubDate>Sat, 01 Aug 2026 09:00:00 GMT</pubDate>");
    expect(xml).toContain("<lastBuildDate>Tue, 01 Sep 2026 00:00:00 GMT</lastBuildDate>");
    expect(xml).toContain("An excerpt with &lt;tags&gt; &amp; ampersands");
    expect(xml.match(/<item>/g)).toHaveLength(2);
  });

  it("is a valid, empty channel when there are no posts", () => {
    const xml = buildRss(fallback("de"), ORIGIN);
    expect(xml).toContain("<language>de</language>");
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
  });
});

describe("sitemap", () => {
  const en = {
    ...fallback("en"),
    projects: fallback("en").projects.map((p, i) =>
      i === 0 ? { ...p, hasCaseStudy: true, updatedAt: "2026-07-01T00:00:00.000Z" } : p,
    ),
    posts: [post("both"), post("english-only", { updatedAt: "2026-09-10T00:00:00.000Z" })],
  };
  const de = { ...fallback("de"), posts: [post("both")] };
  const pages = sitemapPages({
    en: { content: en, lastModified: "Mon, 21 Sep 2026 10:00:00 GMT" },
    de: { content: de, lastModified: null },
  });
  const byPath = new Map(pages.map((p) => [p.path, p.lastmod]));

  it("lists a case study and a post only in the languages that have them", () => {
    expect(byPath.get(`/work/${en.projects[0]!.slug}`)).toEqual({ en: "2026-07-01" });
    expect(byPath.get("/writing/english-only")).toEqual({ en: "2026-09-10" });
    expect(byPath.get("/writing/both")).toEqual({ en: "2026-08-02", de: "2026-08-02" });
    expect(byPath.has(`/work/${en.projects[1]!.slug}`)).toBe(false);
  });

  it("dates the writing index by its newest post, and home by the publish", () => {
    expect(byPath.get("/writing")).toEqual({ en: "2026-09-10", de: "2026-08-02" });
    expect(byPath.get("")).toEqual({ en: "2026-09-21", de: null });
  });

  it("keeps alternates reciprocal and within the languages a page exists in", () => {
    const xml = renderSitemap(pages, ORIGIN);
    const entry = xml
      .split("<url>")
      .find((u) => u.includes("<loc>https://example.test/en/writing/english-only</loc>"));
    expect(entry).toContain('hreflang="en"');
    expect(entry).not.toContain('hreflang="de"');
    expect(entry).toContain(`hreflang="x-default" href="${ORIGIN}/en/writing/english-only"`);
    expect(xml).toContain(`<loc>${ORIGIN}/de/writing/both</loc>`);
  });
});
