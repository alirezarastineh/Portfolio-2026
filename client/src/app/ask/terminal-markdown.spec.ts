import { describe, expect, it } from "vitest";

import {
  citationOrder,
  plainText,
  renderInline,
  renderMarkdown,
  type RenderOptions,
} from "./terminal-markdown";

const options: RenderOptions = {
  cite: (id) => (id === "project:atlas@en" ? 1 : id === "cv@en" ? 2 : null),
  link: (href) =>
    href.startsWith("/") && !href.startsWith("//")
      ? "internal"
      : href === "https://github.com/alirezarastineh"
        ? "external"
        : null,
};

describe("renderInline", () => {
  it("renders bold, code, emphasis and citations", () => {
    expect(renderInline("**Atlas** uses `pgvector` *well* [^project:atlas@en]", options)).toEqual([
      { t: "strong", c: [{ t: "text", v: "Atlas" }] },
      { t: "text", v: " uses " },
      { t: "code", v: "pgvector" },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "well" }] },
      { t: "text", v: " " },
      { t: "cite", id: "project:atlas@en", n: 1 },
    ]);
  });

  it("keeps internal and known links, and turns any other link into its text", () => {
    expect(renderInline("[case study](/en/work/atlas)", options)).toEqual([
      { t: "link", href: "/en/work/atlas", internal: true, c: [{ t: "text", v: "case study" }] },
    ]);
    expect(renderInline("[GitHub](https://github.com/alirezarastineh)", options)[0]).toMatchObject({
      t: "link",
      internal: false,
    });
    for (const href of [
      "https://evil.test",
      "javascript:alert(1)",
      "//evil.test/x",
      "data:text/html,x",
    ]) {
      expect(renderInline(`[click](${href})`, options)).toEqual([{ t: "text", v: "click" }]);
    }
  });

  it("never produces markup from text: tags stay text", () => {
    const nodes = renderInline('<img src=x onerror="alert(1)"> **<b>hi</b>**', options);
    expect(nodes[0]).toEqual({ t: "text", v: '<img src=x onerror="alert(1)"> ' });
    expect(nodes[1]).toEqual({ t: "strong", c: [{ t: "text", v: "<b>hi</b>" }] });
  });

  it("drops a citation the server did not announce", () => {
    expect(renderInline("Claim [^made-up@en].", options)).toEqual([{ t: "text", v: "Claim ." }]);
  });

  it("leaves an unfinished bold literal while it streams", () => {
    expect(renderInline("**Atla", options)).toEqual([{ t: "text", v: "**Atla" }]);
  });
});

describe("renderMarkdown", () => {
  it("splits paragraphs, lists and code blocks", () => {
    const blocks = renderMarkdown(
      "Intro line\nsecond line\n\n- one\n- two\n  continued\n\n1. first\n2. second\n\n```ts\nconst x = 1;\n```",
      options,
    );
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ol", "pre"]);
    expect(blocks[0]).toEqual({ t: "p", c: [{ t: "text", v: "Intro line\nsecond line" }] });
    expect(blocks[1]).toEqual({
      t: "ul",
      items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two continued" }]],
    });
    expect(blocks[3]).toEqual({ t: "pre", v: "const x = 1;" });
  });

  it("treats an unclosed fence as code so far", () => {
    expect(renderMarkdown("```\nline", options)).toEqual([{ t: "pre", v: "line" }]);
  });

  it("shows a heading as a bold line", () => {
    expect(renderMarkdown("## Stack", options)).toEqual([
      { t: "p", c: [{ t: "strong", c: [{ t: "text", v: "Stack" }] }] },
    ]);
  });
});

describe("helpers", () => {
  it("numbers citations by first appearance", () => {
    expect(citationOrder("a [^cv@en] b [^project:atlas@en] c [^cv@en]")).toEqual([
      "cv@en",
      "project:atlas@en",
    ]);
  });

  it("gives screen readers the words only", () => {
    expect(
      plainText("**Atlas** uses `pgvector` [^project:atlas@en]. See [the page](/en/work/atlas)."),
    ).toBe("Atlas uses pgvector. See the page.");
  });
});
