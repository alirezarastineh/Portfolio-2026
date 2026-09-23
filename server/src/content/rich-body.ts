import { highlightCode } from "./highlight.js";
import { decodeEntities, escapeHtml, htmlToText } from "./sanitize.js";
import type { TocEntry } from "./schema.js";

/**
 * Publish-time processing of a sanitized long-form body (case study, post,
 * legal page). The draft keeps the editor's plain HTML; only the published
 * snapshot carries the result, so none of this runs in a visitor's browser.
 *
 * - `h2`/`h3` get ids and form the table of contents;
 * - code blocks are highlighted (`highlight.ts`);
 * - media-library images become `<picture>` with their AVIF/WebP variants and
 *   intrinsic size, so they are responsive and do not shift the layout.
 *
 * The input is sanitized HTML in the exact shape `sanitizeRichText` writes,
 * which is what makes the regular expressions here safe to rely on.
 */

export interface BodyMedia {
  filename: string;
  width: number | null;
  height: number | null;
  variants: { format: string; width: number; filename: string }[];
}

export interface RenderedBody {
  html: string;
  toc: TocEntry[];
}

const WORDS_PER_MINUTE = 220;

export function readingMinutes(html: string): number {
  const words = htmlToText(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-/, "")
    .slice(0, 60)
    .replace(/-$/, "");
  return slug || "section";
}

function addHeadingIds(html: string, toc: TocEntry[]): string {
  const used = new Map<string, number>();
  return html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (whole, level: string, inner: string) => {
    const text = htmlToText(inner).replace(/\s+/g, " ").trim();
    if (!text) return whole;
    const base = slugify(text);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    const id = seen === 0 ? base : `${base}-${seen + 1}`;
    toc.push({ id, text, level: level === "2" ? 2 : 3 });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

async function highlightBlocks(html: string): Promise<string> {
  const pattern = /<pre><code(?: class="language-([a-z0-9+#-]+)")?>([\s\S]*?)<\/code><\/pre>/g;
  const parts: string[] = [];
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    const [whole, lang = null, code = ""] = match;
    parts.push(html.slice(last, match.index));
    const highlighted = await highlightCode(decodeEntities(code), lang);
    // The language survives as a class, so a restore into the draft can undo
    // the highlighting without losing it (restore.ts, `unrenderBody`).
    const label = lang ? ` code-lang-${lang}` : "";
    parts.push(`<pre class="code-block${label}"><code>${highlighted}</code></pre>`);
    last = match.index + whole.length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

function srcset(media: BodyMedia, format: string): string {
  return media.variants
    .filter((v) => v.format === format)
    .sort((a, b) => a.width - b.width)
    .map((v) => `/media/${v.filename} ${v.width}w`)
    .join(", ");
}

/** A body column is at most ~720px wide; anything wider would only waste bytes. */
const BODY_SIZES = "(min-width: 800px) 720px, 100vw";

function enrichImages(html: string, media: ReadonlyMap<string, BodyMedia>): string {
  return html.replace(
    /<img src="\/media\/([^"<>]+)"([^<>]*)>/g,
    (whole, filename: string, rest: string) => {
      const info = media.get(filename);
      if (!info) return whole;

      const alt = /\salt="([^"]*)"/.exec(rest)?.[1] ?? "";
      const title = /\stitle="([^"]*)"/.exec(rest)?.[1];
      const titleAttr = title ? ` title="${title}"` : "";
      const sizeAttr =
        info.width && info.height ? ` width="${info.width}" height="${info.height}"` : "";
      const avif = srcset(info, "avif");
      const webp = srcset(info, "webp");
      const sizesAttr = webp ? ` sizes="${BODY_SIZES}"` : "";
      const img = `<img src="/media/${filename}" alt="${alt}"${titleAttr}${sizeAttr}${sizesAttr} />`;
      if (!avif && !webp) return img;

      const sources = [
        avif
          ? `<source type="image/avif" srcset="${escapeHtml(avif)}" sizes="${BODY_SIZES}" />`
          : "",
        webp
          ? `<source type="image/webp" srcset="${escapeHtml(webp)}" sizes="${BODY_SIZES}" />`
          : "",
      ].join("");
      return `<picture>${sources}${img}</picture>`;
    },
  );
}

export async function renderBody(
  html: string,
  media: ReadonlyMap<string, BodyMedia> = new Map(),
): Promise<RenderedBody> {
  if (!html) return { html: "", toc: [] };
  const toc: TocEntry[] = [];
  // Headings before highlighting: code is escaped by then, so a literal
  // "<h2>" inside a code block can never be mistaken for a heading.
  let out = addHeadingIds(html, toc);
  out = await highlightBlocks(out);
  out = enrichImages(out, media);
  return { html: out, toc };
}

/** `/media/<file>` names a body shows, for looking up their variants. */
export function bodyMediaFilenames(html: string): string[] {
  return [...new Set([...html.matchAll(/<img src="\/media\/([^"]+)"/g)].map((m) => m[1]!))];
}
