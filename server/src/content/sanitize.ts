import sanitizeHtml from "sanitize-html";

/**
 * The allowlist the editor's toolbar can actually produce, plus links. Anything
 * else is stripped rather than escaped, so the stored value stays clean HTML.
 *
 * Applied on **write**, not only at render. Angular's `DomSanitizer` also
 * sanitizes `[innerHTML]`, but `/v1/content/:locale` is public — sanitizing
 * here means the API never serves untrusted markup to anything that consumes
 * it, browser or not.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "s",
    "code",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h3",
    "h4",
    "hr",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
  },
  // Blocks javascript: and data: URLs, which are the usual way a link becomes
  // script execution.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  // Anything opening a new tab must not be able to reach back via window.opener.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs["target"]
        ? { ...attribs, rel: "noreferrer noopener" }
        : attribs,
    }),
  },
  // Empty paragraphs are how an editor makes spacing; keep them.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
};

export function sanitizeRichText(value: string): string {
  const cleaned = sanitizeHtml(value, OPTIONS).trim();
  // Tiptap emits "<p></p>" for an empty document; normalise it away so an
  // empty field is genuinely empty rather than rendering a blank paragraph.
  return cleaned === "<p></p>" ? "" : cleaned;
}

/** Wraps legacy plain text in a paragraph, escaping anything HTML-ish first. */
export function plainTextToRichText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\s*<(p|ul|ol|h3|h4|blockquote)[\s>]/i.test(trimmed)) return sanitizeRichText(trimmed);

  return trimmed
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br />")}</p>`,
    )
    .join("");
}
