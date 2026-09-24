/**
 * The assistant's small Markdown subset — paragraphs, lists, fenced code,
 * **bold**, *emphasis*, `code`, links and citation markers — turned into a
 * tree the template renders with ordinary bindings. No HTML from the model is
 * ever rendered, links are kept only when they are internal or known (the
 * rest become plain text), and citations become footnote numbers.
 *
 * Tolerant of half-streamed text: an unclosed fence is code so far, an
 * unclosed `**` is literal until it closes.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; internal: boolean; c: Inline[] }
  | { t: "cite"; id: string; n: number };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "pre"; v: string };

export interface RenderOptions {
  /** Footnote number for a citation id; null drops the marker. */
  cite: (id: string) => number | null;
  /** `internal` (router), `external` (new context), or null to drop the link. */
  link: (href: string) => "internal" | "external" | null;
}

const CODE_RE = /^(`+)([^`]+?)\1/;
const CITE_RE = /^\[\^([^\]\s]+)\]/;
const LINK_RE = /^\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const STRONG_RE = /^\*\*([^*\n]+?)\*\*/;
const EM_RE = /^\*([^*\s]+?)\*/;

interface MatchedInline {
  length: number;
  node: Inline | Inline[];
}

function matchCode(slice: string): MatchedInline | null {
  const m = CODE_RE.exec(slice);
  return m ? { length: m[0].length, node: { t: "code", v: m[2]! } } : null;
}

function matchBracket(slice: string, options: RenderOptions): MatchedInline | null {
  const cite = CITE_RE.exec(slice);
  if (cite) {
    const n = options.cite(cite[1]!);
    return {
      length: cite[0].length,
      node: n !== null ? { t: "cite", id: cite[1]!, n } : [],
    };
  }
  const link = LINK_RE.exec(slice);
  if (link) {
    const kind = options.link(link[2]!);
    const inner = renderInline(link[1]!, options);
    return {
      length: link[0].length,
      node: kind ? { t: "link", href: link[2]!, internal: kind === "internal", c: inner } : inner,
    };
  }
  return null;
}

function matchAsterisk(text: string, i: number, options: RenderOptions): MatchedInline | null {
  const slice = text.slice(i);
  const strong = STRONG_RE.exec(slice);
  if (strong) {
    return {
      length: strong[0].length,
      node: { t: "strong", c: renderInline(strong[1]!, options) },
    };
  }
  const prev = i > 0 ? text[i - 1] : " ";
  if (!/\w/.test(prev!)) {
    const em = EM_RE.exec(slice);
    if (em) {
      return {
        length: em[0].length,
        node: { t: "em", c: renderInline(em[1]!, options) },
      };
    }
  }
  return null;
}

function matchInlineAt(text: string, i: number, options: RenderOptions): MatchedInline | null {
  const ch = text[i];
  if (ch === "`") return matchCode(text.slice(i));
  if (ch === "[") return matchBracket(text.slice(i), options);
  if (ch === "*") return matchAsterisk(text, i, options);
  return null;
}

function pushInline(out: Inline[], node: Inline): void {
  const last = out.at(-1);
  if (node.t === "text" && last?.t === "text") last.v += node.v;
  else out.push(node);
}

function appendNodes(out: Inline[], node: Inline | Inline[]): void {
  if (Array.isArray(node)) {
    for (const n of node) pushInline(out, n);
  } else {
    pushInline(out, node);
  }
}

export function renderInline(text: string, options: RenderOptions): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  let i = 0;
  while (i < text.length) {
    const matched = matchInlineAt(text, i, options);
    if (!matched) {
      i++;
      continue;
    }
    if (i > at) pushInline(out, { t: "text", v: text.slice(at, i) });
    appendNodes(out, matched.node);
    i += matched.length;
    at = i;
  }
  if (at < text.length) pushInline(out, { t: "text", v: text.slice(at) });
  return out;
}

const BULLET = /^\s{0,3}[-*•]\s+(\S.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(\S.*)$/;
const FENCE = /^\s{0,3}```/;
const HEADING = /^\s{0,3}#{1,6}\s+(\S.*)$/;

function parseFence(lines: string[], startIndex: number): { code: string; nextIndex: number } {
  const code: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length && !FENCE.test(lines[i]!)) {
    code.push(lines[i]!);
    i++;
  }
  if (i < lines.length) i++;
  return { code: code.join("\n"), nextIndex: i };
}

function parseList(
  lines: string[],
  startIndex: number,
  ordered: boolean,
): { items: string[]; nextIndex: number } {
  const items: string[] = [];
  let i = startIndex;
  while (i < lines.length) {
    const current = lines[i]!;
    const item = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
    if (item) {
      items.push(ordered ? item[2]! : item[1]!);
      i++;
    } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
      items[items.length - 1] += ` ${current.trim()}`;
      i++;
    } else {
      break;
    }
  }
  return { items, nextIndex: i };
}

export function renderMarkdown(text: string, options: RenderOptions): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ t: "p", c: renderInline(paragraph.join("\n"), options) });
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      flush();
      const parsed = parseFence(lines, i);
      blocks.push({ t: "pre", v: parsed.code });
      i = parsed.nextIndex;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const start = numbered ? Number(numbered[1]) : 1;
      const parsed = parseList(lines, i, ordered);
      const rendered = parsed.items.map((item) => renderInline(item, options));
      blocks.push(ordered ? { t: "ol", start, items: rendered } : { t: "ul", items: rendered });
      i = parsed.nextIndex;
      continue;
    }

    if (!line.trim()) {
      flush();
      i++;
      continue;
    }

    // Headings are not part of the subset; shown as bold lines if a model sends one.
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ t: "p", c: [{ t: "strong", c: renderInline(heading[1]!, options) }] });
      i++;
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return blocks;
}

/** Citation ids in order of first appearance, for footnote numbers. */
export function citationOrder(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    if (!seen.includes(m[1]!)) seen.push(m[1]!);
  }
  return seen;
}

/** The answer as a screen reader should hear it once: no markers, no Markdown. */
export function plainText(text: string): string {
  return text
    .replace(/ ?\[\^[^\]\s]{1,100}\]/g, "")
    .replace(/```[^\n]{0,100}\n?/g, "")
    .replace(/\*\*([^*\n]{1,1000})\*\*/g, "$1")
    .replace(/`([^`\n]{1,1000})`/g, "$1")
    .replace(/\[([^\]\n]{1,500})\]\([^)\n]{1,1000}\)/g, "$1")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
