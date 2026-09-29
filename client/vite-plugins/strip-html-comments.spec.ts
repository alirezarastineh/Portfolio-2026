import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripHtmlComments, withoutComments } from "./strip-html-comments";

const INDEX = resolve(dirname(fileURLToPath(import.meta.url)), "../index.html");

describe("stripHtmlComments", () => {
  it("drops comments, one-line and multi-line, with the lines they stood on", () => {
    const html = [
      "<head>",
      '  <meta charset="utf-8" />',
      "  <!-- One line. -->",
      "  <!-- Two",
      "       lines. -->",
      '  <script id="theme-init">x()</script>',
      "</head>",
    ].join("\n");
    expect(withoutComments(html)).toBe(
      [
        "<head>",
        '  <meta charset="utf-8" />',
        '  <script id="theme-init">x()</script>',
        "</head>",
      ].join("\n"),
    );
  });

  it("leaves index.html without a comment, and everything else in place", () => {
    const html = readFileSync(INDEX, "utf8");
    const out = (
      stripHtmlComments().transformIndexHtml as { handler: (h: string) => string }
    ).handler(html);

    expect(out).not.toContain("<!--");
    expect(out.length).toBeLessThan(html.length);
    for (const kept of [
      '<script id="theme-init">',
      '<meta name="theme-color"',
      '<link rel="stylesheet" href="/src/styles.css" />',
      "<app-root></app-root>",
    ]) {
      expect(out).toContain(kept);
    }
  });

  it("strips inline comments without affecting surrounding markup", () => {
    expect(withoutComments("<p>Hello <!-- comment -->world</p>")).toBe(
      "<p>Hello world</p>",
    );
  });
});
