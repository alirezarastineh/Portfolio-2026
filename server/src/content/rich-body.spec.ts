import { beforeAll, describe, expect, it } from "vitest";

import { supportedLanguages } from "./highlight.js";
import { unrenderBody } from "./restore.js";
import {
  bodyMediaFilenames,
  readingMinutes,
  renderBody,
  slugify,
  type BodyMedia,
} from "./rich-body.js";
import { sanitizeRichText } from "./sanitize.js";

const media = new Map<string, BodyMedia>([
  [
    "a.png",
    {
      filename: "a.png",
      width: 1600,
      height: 900,
      variants: [
        { format: "webp", width: 480, filename: "a-480w.webp" },
        { format: "avif", width: 480, filename: "a-480w.avif" },
        { format: "webp", width: 768, filename: "a-768w.webp" },
      ],
    },
  ],
]);

// Shiki loads its grammars and themes once, on first use: seconds on a busy
// machine. Paid here, so no test's own timeout includes it.
beforeAll(() => supportedLanguages(), 30_000);

describe("slugify", () => {
  it("makes readable, ASCII ids from headings in either language", () => {
    expect(slugify("Why RAG, and why now?")).toBe("why-rag-and-why-now");
    expect(slugify("Größe & Übersicht")).toBe("grosse-ubersicht");
    expect(slugify("!!!")).toBe("section");
  });
});

describe("renderBody", () => {
  it("gives h2/h3 unique ids and builds the table of contents", async () => {
    const { html, toc } = await renderBody(
      "<h2>Intro</h2><p>x</p><h3>Detail <em>here</em></h3><h2>Intro</h2>",
    );
    expect(toc).toEqual([
      { id: "intro", text: "Intro", level: 2 },
      { id: "detail-here", text: "Detail here", level: 3 },
      { id: "intro-2", text: "Intro", level: 2 },
    ]);
    expect(html).toContain('<h3 id="detail-here">Detail <em>here</em></h3>');
  });

  it("highlights known languages into classes, and escapes the rest", async () => {
    const known = await renderBody(
      '<pre><code class="language-ts">const a: number = 1;</code></pre>',
    );
    expect(known.html).toMatch(/^<pre class="code-block code-lang-ts"><code><span class="line">/);
    expect(known.html).toMatch(/<span class="shd-[0-9a-f]+ shl-[0-9a-f]+">const<\/span>/);
    expect(known.html).not.toContain("style=");

    const unknown = await renderBody('<pre><code class="language-cobol">&lt;tag&gt;</code></pre>');
    expect(unknown.html).toBe(
      '<pre class="code-block code-lang-cobol"><code>&lt;tag&gt;</code></pre>',
    );
  });

  it("never mistakes a heading inside code for a real one", async () => {
    const { toc } = await renderBody("<pre><code>&lt;h2&gt;not a heading&lt;/h2&gt;</code></pre>");
    expect(toc).toEqual([]);
  });

  it("turns a media-library image into a responsive picture", async () => {
    const { html } = await renderBody('<p>x</p><img src="/media/a.png" alt="Chart" />', media);
    expect(html).toBe(
      "<p>x</p><picture>" +
        '<source type="image/avif" srcset="/media/a-480w.avif 480w" sizes="(min-width: 800px) 720px, 100vw" />' +
        '<source type="image/webp" srcset="/media/a-480w.webp 480w, /media/a-768w.webp 768w" sizes="(min-width: 800px) 720px, 100vw" />' +
        '<img src="/media/a.png" alt="Chart" width="1600" height="900" sizes="(min-width: 800px) 720px, 100vw" />' +
        "</picture>",
    );
  });

  it("leaves an image it knows nothing about as it was", async () => {
    const { html } = await renderBody('<img src="/media/unknown.png" alt="" />', media);
    expect(html).toBe('<img src="/media/unknown.png" alt="" />');
  });

  it("finds the media a body shows", () => {
    expect(
      bodyMediaFilenames('<img src="/media/a.png" /><p></p><img src="/media/b.webp" alt="" />'),
    ).toEqual(["a.png", "b.webp"]);
  });
});

describe("readingMinutes", () => {
  it("counts words at 220 a minute, at least one", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(`<p>${"word ".repeat(441)}</p>`)).toBe(3);
  });
});

describe("unrenderBody", () => {
  it("returns a published body to exactly what the editor saved", async () => {
    const draft = sanitizeRichText(
      '<h2>Title</h2><p>Text with <a href="https://x.example">a link</a>.</p>' +
        '<pre><code class="language-typescript">const answer = 42; // &lt;ok&gt;</code></pre>' +
        '<img src="/media/a.png" alt="Chart" />',
    );
    const published = await renderBody(draft, media);
    expect(unrenderBody(published.html)).toBe(draft);
  });
});

describe("sanitizeRichText", () => {
  it("keeps the new block types and a code language, and nothing else", () => {
    expect(sanitizeRichText('<h2 class="x" id="y">T</h2><blockquote>q</blockquote><hr />')).toBe(
      "<h2>T</h2><blockquote>q</blockquote><hr />",
    );
    expect(sanitizeRichText('<pre><code class="language-ts evil">x</code></pre>')).toBe(
      "<pre><code>x</code></pre>",
    );
    expect(sanitizeRichText('<pre><code class="language-ts">x</code></pre>')).toBe(
      '<pre><code class="language-ts">x</code></pre>',
    );
  });

  it("allows images only from the media library", () => {
    expect(sanitizeRichText('<img src="/media/a.png" alt="ok" onerror="x()" width="9" />')).toBe(
      '<img src="/media/a.png" alt="ok" />',
    );
    for (const src of [
      "https://tracker.example/p.gif",
      "//evil.example/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "/media/../etc/passwd",
      "/other/a.png",
    ]) {
      expect(sanitizeRichText(`<p>a</p><img src="${src}" />`), src).toBe("<p>a</p>");
    }
  });
});
