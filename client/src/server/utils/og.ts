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
  /** What this is, above the title, in sentence case. */
  eyebrow: string;
  title: string;
  summary: string;
  /** Up to three headline numbers (case studies). */
  metrics: { value: string; label: string }[];
  /** Date, reading time, tags (posts). */
  meta: string;
  /** The assistant's prompt instead of the facts (the site's own card). */
  prompt?: string;
  author: string;
  role: string;
  site: string;
}

export interface OgFonts {
  regular: Buffer;
  semibold: Buffer;
  data: Buffer;
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
      meta: project.stack.slice(0, 5).join(", "),
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
    meta: `${formatDay(post.publishedAt, locale)}, ${fmt(t.writing.readingTime, { n: post.readingMinutes })}`,
  };
}

/**
 * The site's own card (public/og.png, drawn by scripts/og-default.ts): the
 * name, the role and the hero's headline, over the assistant's prompt.
 */
export function ogSiteCard(content: AppContent, locale: Locale): OgCard {
  const t = content.ui;
  return {
    locale,
    eyebrow: t.profile.role,
    title: content.identity.name,
    summary: t.profile.heroHeadline,
    metrics: [],
    meta: "",
    prompt: t.ask.title,
    author: "",
    role: "",
    site: hostOf(content.identity.siteUrl || content.seo.canonical),
  };
}

/**
 * Bumped when the drawing changes, so every card gets a new key and ETag
 * (a cached card would otherwise keep the old look). Redraw public/og.png
 * then too: scripts/og-default.ts.
 */
const OG_DESIGN = "3";

/** A content hash of the card: the cache key and ETag, new whenever the card would change. */
export function ogCardKey(card: OgCard): string {
  return createHash("sha256")
    .update(OG_DESIGN)
    .update(JSON.stringify(card))
    .digest("base64url")
    .slice(0, 32);
}

export async function renderOgPng(card: OgCard, fonts: OgFonts): Promise<Buffer> {
  const svg = await satori(ogTree(card), {
    ...OG_SIZE,
    fonts: [
      { name: "Instrument Sans", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Instrument Sans", data: fonts.semibold, weight: 600, style: "normal" },
      { name: "B612", data: fonts.data, weight: 400, style: "normal" },
    ] satisfies Font[],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_SIZE.width } }).render().asPng();
}

/**
 * The dark theme's tokens (src/styles/tokens.css), which Satori cannot read.
 * src/styles/tokens.spec.ts keeps these equal to the tokens.
 */
export const OG_COLOR = {
  background: "#000000",
  foreground: "#ededee",
  mutedForeground: "#b4b4b9",
  signal: "#ff4f00",
} as const;

const COLOR = OG_COLOR;
const PAD = 64;

interface Node {
  type: string;
  props: Record<string, unknown> & {
    style?: Record<string, unknown>;
    children?: (Node | string)[] | Node | string;
  };
}

function el(style: Record<string, unknown>, ...children: (Node | string)[]): Node {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

function text(style: Record<string, unknown>, value: string): Node {
  return { type: "div", props: { style: { display: "block", ...style }, children: value } };
}

/** The dot and the line: the site's one mark, running off the card. */
function trace(): Node {
  return el(
    { alignItems: "center", marginRight: -PAD },
    el({ width: 16, height: 16, backgroundColor: COLOR.signal }),
    el({ flexGrow: 1, height: 3, backgroundColor: COLOR.signal }),
  );
}

/** The hero's console at rest: the prompt and the question. */
function promptLine(question: string): Node {
  return el(
    { alignItems: "center", gap: 14, fontSize: 26 },
    text({ color: COLOR.signal }, ">"),
    text({ color: COLOR.foreground }, question),
  );
}

/**
 * What the footer leads with: the prompt (the site's card), the metrics as
 * the case study's band shows them, or the post's date line.
 */
function facts(card: OgCard): Node {
  if (card.prompt) return promptLine(card.prompt);
  if (card.metrics.length === 0) {
    return text(
      {
        fontFamily: "B612",
        fontSize: 21,
        color: COLOR.mutedForeground,
        maxWidth: 700,
        lineClamp: 2,
      },
      card.meta,
    );
  }
  return el(
    { gap: 36, flexShrink: 1 },
    ...card.metrics.map((metric) =>
      el(
        { flexDirection: "column", gap: 6, width: 206 },
        text({ fontSize: 46, fontWeight: 600, lineHeight: 1, letterSpacing: -1.4 }, metric.value),
        text(
          {
            fontFamily: "B612",
            fontSize: 18,
            lineHeight: 1.3,
            color: COLOR.mutedForeground,
            lineClamp: 2,
          },
          metric.label,
        ),
      ),
    ),
  );
}

/**
 * The title's size by its length: as large as two lines allow, down to 56px;
 * past that, three lines and a one-line summary, so the card never overflows.
 */
function titleStyle(title: string): { fontSize: number; lines: number; summaryLines: number } {
  if (title.length <= 24) return { fontSize: 80, lines: 2, summaryLines: 2 };
  if (title.length <= 56) return { fontSize: 68, lines: 2, summaryLines: 2 };
  if (title.length <= 72) return { fontSize: 56, lines: 2, summaryLines: 2 };
  return { fontSize: 56, lines: 3, summaryLines: 1 };
}

/** The card as Satori's element tree (the shape React elements have). */
export function ogTree(card: OgCard): Node {
  const title = titleStyle(card.title);

  const header = text(
    { fontFamily: "B612", fontSize: 22, color: COLOR.mutedForeground },
    card.site,
  );

  const body = el(
    { flexDirection: "column", justifyContent: "center", flexGrow: 1, gap: 20, maxWidth: 1040 },
    text(
      { fontFamily: "B612", fontSize: 21, color: COLOR.mutedForeground, lineClamp: 1 },
      card.eyebrow,
    ),
    text(
      {
        fontSize: title.fontSize,
        fontWeight: 600,
        lineHeight: 1.04,
        letterSpacing: -0.03 * title.fontSize,
        color: COLOR.foreground,
        lineClamp: title.lines,
      },
      card.title,
    ),
    ...(card.summary
      ? [
          text(
            {
              fontSize: 27,
              lineHeight: 1.4,
              color: COLOR.mutedForeground,
              maxWidth: 980,
              lineClamp: title.summaryLines,
            },
            card.summary,
          ),
        ]
      : []),
  );

  const byline = card.author
    ? [
        el(
          { flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0, maxWidth: 360 },
          text({ fontSize: 26, fontWeight: 600, color: COLOR.foreground }, card.author),
          text({ fontFamily: "B612", fontSize: 17, color: COLOR.mutedForeground }, card.role),
        ),
      ]
    : [];

  const footer = el(
    { alignItems: "flex-end", justifyContent: "space-between", gap: 32 },
    facts(card),
    ...byline,
  );

  return el(
    {
      ...OG_SIZE,
      boxSizing: "border-box",
      flexDirection: "column",
      gap: 24,
      padding: PAD,
      fontFamily: "Instrument Sans",
      color: COLOR.foreground,
      backgroundColor: COLOR.background,
    },
    header,
    body,
    trace(),
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
