import type { AppContent } from "../../app/content/schema";
import { escapeXml } from "./xml";

/**
 * RSS 2.0 for one language's posts: title, link, date and excerpt per post —
 * the excerpt, not the body, so a reader visits the page for the rest.
 */

/** RFC 822 dates, as RSS wants them (`Tue, 23 Sep 2026 10:00:00 GMT`). */
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export function buildRss(content: AppContent, origin: string): string {
  const { locale } = content;
  const index = `${origin}/${locale}/writing`;
  const self = `${origin}/${locale}/rss.xml`;
  const newest = content.posts.reduce<string | null>(
    (latest, post) => (latest && latest > post.updatedAt ? latest : post.updatedAt),
    null,
  );

  const items = content.posts.map((post) => {
    const url = `${origin}/${locale}/writing/${post.slug}`;
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${rfc822(post.publishedAt)}</pubDate>`,
      ...(post.excerpt ? [`      <description>${escapeXml(post.excerpt)}</description>`] : []),
      ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      "    </item>",
    ].join("\n");
  });

  const title = escapeXml(`${content.ui.writing.heading} · ${content.identity.name}`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${title}</title>`,
    `    <link>${escapeXml(index)}</link>`,
    `    <description>${escapeXml(content.ui.writing.subtitle)}</description>`,
    `    <language>${locale}</language>`,
    ...(newest ? [`    <lastBuildDate>${rfc822(newest)}</lastBuildDate>`] : []),
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
