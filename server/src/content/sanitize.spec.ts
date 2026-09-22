import { describe, expect, it } from "vitest";

import { plainTextToRichText, sanitizeRichText } from "./sanitize.js";

describe("sanitizeRichText", () => {
  it("keeps the formatting the editor can produce", () => {
    const html = "<p>Intro <strong>bold</strong> <em>italic</em> <code>code</code></p><ul><li>One</li></ul>";
    expect(sanitizeRichText(html)).toBe(html);
  });

  /**
   * This is the whole point of sanitizing on write: `/v1/content/:locale` is
   * public, so the API must never *serve* untrusted markup, whatever the
   * consumer does with it.
   */
  it("strips script tags and their contents", () => {
    expect(sanitizeRichText("<p>ok</p><script>alert(1)</script>")).toBe("<p>ok</p>");
  });

  it("strips event handler attributes", () => {
    const out = sanitizeRichText('<p onclick="steal()">text</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("text");
  });

  it("strips elements that can load or execute", () => {
    for (const html of [
      '<img src="x" onerror="alert(1)">',
      "<iframe src='https://evil.example'></iframe>",
      "<object data='x'></object>",
      "<svg><script>alert(1)</script></svg>",
      "<style>body{display:none}</style>",
    ]) {
      const out = sanitizeRichText(html);
      expect(out, html).not.toMatch(/<(img|iframe|object|svg|script|style)/i);
      expect(out, html).not.toMatch(/alert\(1\)/);
    }
  });

  it("rejects javascript: and data: URLs but keeps http, https and mailto", () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    expect(sanitizeRichText('<a href="data:text/html,<script>">x</a>')).not.toContain("data:");
    expect(sanitizeRichText('<a href="https://ok.example">x</a>')).toContain("https://ok.example");
    expect(sanitizeRichText('<a href="mailto:a@b.c">x</a>')).toContain("mailto:a@b.c");
  });

  /** A new tab must not be able to reach back through window.opener. */
  it("adds rel=noreferrer noopener to links opening a new tab", () => {
    expect(sanitizeRichText('<a href="https://ok.example" target="_blank">x</a>')).toContain(
      'rel="noreferrer noopener"',
    );
  });

  it("normalises an empty document to an empty string", () => {
    expect(sanitizeRichText("<p></p>")).toBe("");
    expect(sanitizeRichText("   ")).toBe("");
  });

  it("is idempotent", () => {
    const once = sanitizeRichText('<p>a</p><script>x</script><a href="https://x.example">l</a>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe("plainTextToRichText", () => {
  it("wraps plain text in a paragraph", () => {
    expect(plainTextToRichText("Hello world")).toBe("<p>Hello world</p>");
  });

  it("splits blank-line-separated blocks into paragraphs", () => {
    expect(plainTextToRichText("One\n\nTwo")).toBe("<p>One</p><p>Two</p>");
  });

  it("turns a single newline into a line break", () => {
    expect(plainTextToRichText("One\nTwo")).toBe("<p>One<br />Two</p>");
  });

  /** Plain text containing angle brackets must not become live markup. */
  it("escapes HTML-ish plain text rather than trusting it", () => {
    expect(plainTextToRichText("a < b && c > d")).toBe("<p>a &lt; b &amp;&amp; c &gt; d</p>");
  });

  /** Re-running the migration must not double-wrap. */
  it("passes already-rich content through the sanitizer instead of wrapping", () => {
    expect(plainTextToRichText("<p>Already rich</p>")).toBe("<p>Already rich</p>");
    expect(plainTextToRichText("<ul><li>x</li></ul>")).toBe("<ul><li>x</li></ul>");
  });

  it("returns an empty string for empty input", () => {
    expect(plainTextToRichText("")).toBe("");
    expect(plainTextToRichText("   \n  ")).toBe("");
  });
});
