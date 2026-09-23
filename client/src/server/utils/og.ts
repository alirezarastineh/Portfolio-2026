import { createHash } from "node:crypto";

import { Resvg } from "@resvg/resvg-js";
import satori, { type Font } from "satori";

import type { AppContent, Locale } from "../../app/content/schema";
import { formatDay } from "../../app/content/period";
import { fmt } from "../../app/i18n/interpolate";

/**
 * Social cards for case studies and posts (`og:image`): 1200×630 PNGs drawn
 * from the published content — title, summary, the headline metrics or the
 * post's date — in the site's look. Satori lays the card out as SVG and resvg
 * rasterises it; no browser involved.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

export type OgKind = "work" | "writing";

export interface OgCard {
  locale: Locale;
  /** `// case study`-style label above the title. */
  eyebrow: string;
  title: string;
  summary: string;
  /** Up to three headline numbers (case studies). */
  metrics: { value: string; label: string }[];
  /** Date, reading time, tags (posts). */
  meta: string;
  author: string;
  role: string;
  site: string;
}

export interface OgFonts {
  regular: Buffer;
  semibold: Buffer;
  mono: Buffer;
}

/** The card for a case study or post, or null when there is none in this language. */
export function ogCardFor(
  content: AppContent,
  locale: Locale,
  kind: OgKind,
  slug: string,
): OgCard | null {
  const t = content.ui;
  const base = {
    locale,
    author: content.identity.name,
    role: t.profile.role,
    site: hostOf(content.identity.siteUrl || content.seo.canonical),
  };

  if (kind === "work") {
    const project = content.projects.find((p) => p.slug === slug && p.hasCaseStudy);
    if (!project) return null;
    return {
      ...base,
      eyebrow: project.descriptor || t.nav.work,
      title: project.name,
      summary: project.hook,
      metrics: project.metrics.slice(0, 3).map(({ value, label }) => ({ value, label })),
      meta: project.stack.slice(0, 5).join(" · "),
    };
  }

  const post = content.posts.find((p) => p.slug === slug);
  if (!post) return null;
  return {
    ...base,
    eyebrow: t.nav.writing,
    title: post.title,
    summary: post.excerpt,
    metrics: [],
    meta: [
      formatDay(post.publishedAt, locale),
      fmt(t.writing.readingTime, { n: post.readingMinutes }),
      ...post.tags.slice(0, 3).map((tag) => `#${tag}`),
    ].join(" · "),
  };
}

/** A content hash of the card: the cache key and ETag, new whenever the card would change. */
export function ogCardKey(card: OgCard): string {
  return createHash("sha256").update(JSON.stringify(card)).digest("base64url").slice(0, 32);
}

export async function renderOgPng(card: OgCard, fonts: OgFonts): Promise<Buffer> {
  const svg = await satori(ogTree(card), {
    ...OG_SIZE,
    fonts: [
      { name: "Geist", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Geist", data: fonts.semibold, weight: 600, style: "normal" },
      { name: "Geist Mono", data: fonts.mono, weight: 500, style: "normal" },
    ] satisfies Font[],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_SIZE.width } }).render().asPng();
}

// The dark theme's tokens (src/styles/tokens.css), as sRGB for Satori.
const COLOR = {
  background: "#121212",
  card: "#1b1b1b",
  foreground: "#f7f7f7",
  muted: "#c6c6c6",
  border: "rgba(255, 255, 255, 0.13)",
  orange: "#ff7115",
} as const;

interface Node {
  type: string;
  props: { style?: Record<string, unknown>; children?: (Node | string)[] | Node | string };
}

function el(style: Record<string, unknown>, ...children: (Node | string)[]): Node {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function text(style: Record<string, unknown>, value: string): Node {
  return { type: "div", props: { style: { display: "block", ...style }, children: value } };
}

/** The card as Satori's element tree (the shape React elements have). */
export function ogTree(card: OgCard): Node {
  const long = card.title.length > 42;
  const mark = el(
    {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      border: `1px solid ${COLOR.border}`,
      backgroundColor: COLOR.card,
      fontFamily: "Geist Mono",
      fontSize: 26,
      fontWeight: 500,
    },
    text({ color: COLOR.orange }, ">"),
    text({ color: COLOR.foreground }, "_"),
  );

  const header = el(
    { alignItems: "center", gap: 18 },
    mark,
    text({ fontFamily: "Geist Mono", fontSize: 22, color: COLOR.muted }, card.site),
  );

  const body = el(
    { flexDirection: "column", gap: 22, maxWidth: 1040 },
    text(
      {
        fontFamily: "Geist Mono",
        fontSize: 20,
        fontWeight: 500,
        letterSpacing: 3,
        textTransform: "uppercase",
        color: COLOR.orange,
      },
      `// ${card.eyebrow}`,
    ),
    text(
      {
        fontSize: long ? 58 : 72,
        fontWeight: 600,
        lineHeight: 1.05,
        letterSpacing: -2,
        color: COLOR.foreground,
        lineClamp: 3,
      },
      card.title,
    ),
    ...(card.summary
      ? [text({ fontSize: 28, lineHeight: 1.35, color: COLOR.muted, lineClamp: 2 }, card.summary)]
      : []),
  );

  const facts = card.metrics.length
    ? el(
        { gap: 48 },
        ...card.metrics.map((metric) =>
          el(
            { flexDirection: "column", gap: 4 },
            text({ fontSize: 44, fontWeight: 600, color: COLOR.orange }, metric.value),
            text({ fontSize: 20, color: COLOR.muted, maxWidth: 260 }, metric.label),
          ),
        ),
      )
    : text(
        { fontFamily: "Geist Mono", fontSize: 22, color: COLOR.muted, maxWidth: 760 },
        card.meta,
      );

  const footer = el(
    { alignItems: "flex-end", justifyContent: "space-between", gap: 32 },
    facts,
    el(
      { flexDirection: "column", alignItems: "flex-end", gap: 6 },
      text({ fontSize: 26, fontWeight: 600, color: COLOR.foreground }, card.author),
      text({ fontFamily: "Geist Mono", fontSize: 18, color: COLOR.muted }, card.role),
    ),
  );

  return el(
    {
      ...OG_SIZE,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 64,
      fontFamily: "Geist",
      backgroundColor: COLOR.background,
      borderTop: `6px solid ${COLOR.orange}`,
    },
    header,
    body,
    footer,
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "alirezarastineh.me";
  }
}
