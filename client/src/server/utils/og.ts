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
  /** A terminal prompt instead of the facts (the site's own card): `~$ ask my portfolio`. */
  prompt?: string;
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
const OG_DESIGN = "2";

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
      { name: "Geist", data: fonts.regular, weight: 400, style: "normal" },
      { name: "Geist", data: fonts.semibold, weight: 600, style: "normal" },
      { name: "Geist Mono", data: fonts.mono, weight: 500, style: "normal" },
    ] satisfies Font[],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: OG_SIZE.width } }).render().asPng();
}

/**
 * The dark theme's tokens (src/styles/tokens.css) in sRGB: Satori and resvg
 * take hex and rgba, not oklch. The orange lies outside sRGB and is clipped
 * into it, as an sRGB screen shows it. src/styles/tokens.spec.ts keeps these
 * equal to the tokens.
 */
export const OG_COLOR = {
  background: "#101012",
  card: "#161719",
  foreground: "#f5f5f5",
  mutedForeground: "#bcbec1",
  borderStrong: "rgba(255, 255, 255, 0.2)",
  orange: "#ff7115",
  indigo: "#7472f4",
} as const;

const COLOR = OG_COLOR;
const PAD = 64;

/** The assistant's pipeline, as the hero's trace panel names its steps (app/visuals/trace.ts). */
const TRACE_STEPS = ["query", "route", "retrieve", "generate", "cite", "answer"] as const;

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

function svg(type: string, props: Record<string, unknown>, ...children: Node[]): Node {
  return { type, props: { ...props, children } };
}

/** The favicon's `>_` (public/favicon.svg) on a card-coloured tile. */
function mark(): Node {
  return el(
    {
      width: 56,
      height: 56,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      border: `1px solid ${COLOR.borderStrong}`,
      backgroundColor: COLOR.card,
    },
    svg(
      "svg",
      { width: 36, height: 36, viewBox: "8 8 48 48" },
      svg("path", {
        d: "M17 21 29 32 17 43",
        fill: "none",
        stroke: COLOR.orange,
        strokeWidth: 6.5,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }),
      svg("path", {
        d: "M34 44h13",
        stroke: COLOR.foreground,
        strokeWidth: 6.5,
        strokeLinecap: "round",
      }),
    ),
  );
}

/**
 * The trace motif: the hero's pipeline as one line of steps, each done
 * (indigo) up to the answer (orange). No timings: it is not a real trace.
 */
function trace(): Node {
  const last = TRACE_STEPS.length - 1;
  return el(
    { alignItems: "center", gap: 10, fontFamily: "Geist Mono", fontSize: 16 },
    ...TRACE_STEPS.flatMap((step, i) => [
      ...(i > 0 ? [el({ width: 14, height: 1, backgroundColor: COLOR.borderStrong })] : []),
      el(
        { alignItems: "center", gap: 8 },
        el({
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: i === last ? COLOR.orange : COLOR.indigo,
        }),
        text({ color: i === last ? COLOR.foreground : COLOR.mutedForeground }, step),
      ),
    ]),
  );
}

/**
 * The hero's dot grid, full-bleed and fading out towards the text. The stops
 * are in percent of the tile's gradient: Satori measures pixel stops against
 * the whole card, which shrinks the dots to nothing.
 */
function dotGrid(): Node {
  return el({
    position: "absolute",
    left: 0,
    top: 0,
    ...OG_SIZE,
    backgroundImage: `radial-gradient(circle at 50% 50%, ${COLOR.indigo} 0%, ${COLOR.indigo} 9%, transparent 11%)`,
    backgroundSize: "24px 24px",
    opacity: 0.7,
    maskImage: "radial-gradient(ellipse 80% 110% at 100% 0%, #000 0%, transparent 100%)",
  });
}

/** The hero's ask bar at rest: the prompt, the question, the caret. */
function promptLine(question: string): Node {
  return el(
    { alignItems: "center", gap: 14, fontFamily: "Geist Mono", fontSize: 26 },
    text({ color: COLOR.orange }, "~$"),
    text({ color: COLOR.foreground }, question),
    el({ width: 14, height: 28, backgroundColor: COLOR.orange }),
  );
}

/**
 * What the footer leads with: the prompt (the site's card), the metrics as
 * the case study's band shows them (the number under an orange rule), or the
 * post's date line.
 */
function facts(card: OgCard): Node {
  if (card.prompt) return promptLine(card.prompt);
  if (card.metrics.length === 0) {
    return text(
      {
        fontFamily: "Geist Mono",
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
        {
          flexDirection: "column",
          gap: 6,
          width: 206,
          paddingTop: 14,
          borderTop: `2px solid ${COLOR.orange}`,
        },
        text({ fontSize: 46, fontWeight: 600, lineHeight: 1, letterSpacing: -1.4 }, metric.value),
        text(
          { fontSize: 19, lineHeight: 1.3, color: COLOR.mutedForeground, lineClamp: 2 },
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

  const header = el(
    { alignItems: "center", justifyContent: "space-between", gap: 32 },
    el(
      { alignItems: "center", gap: 18 },
      mark(),
      text({ fontFamily: "Geist Mono", fontSize: 22, color: COLOR.mutedForeground }, card.site),
    ),
    trace(),
  );

  const body = el(
    { flexDirection: "column", gap: 20, maxWidth: 1040 },
    text(
      {
        fontFamily: "Geist Mono",
        fontSize: 19,
        fontWeight: 500,
        letterSpacing: 2.6,
        textTransform: "uppercase",
        color: COLOR.mutedForeground,
        lineClamp: 1,
      },
      card.eyebrow,
    ),
    text(
      {
        fontSize: title.fontSize,
        fontWeight: 600,
        lineHeight: 1.04,
        letterSpacing: -0.035 * title.fontSize,
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
          text({ fontFamily: "Geist Mono", fontSize: 17, color: COLOR.mutedForeground }, card.role),
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
      position: "relative",
      flexDirection: "column",
      justifyContent: "space-between",
      gap: 24,
      padding: PAD,
      fontFamily: "Geist",
      color: COLOR.foreground,
      backgroundColor: COLOR.background,
    },
    dotGrid(),
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
