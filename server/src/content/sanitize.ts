import sanitizeHtml from "sanitize-html";

/** An uploaded file, relative to the site: the only images a body may show. */
const MEDIA_SRC = /^\/media\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** `language-typescript` on a code block, as Tiptap's CodeBlock writes it. */
const CODE_LANGUAGE = /^language-[a-z0-9+#-]{1,30}$/;

/**
 * The allowlist the editor's toolbar can actually produce, plus links. Anything
 * else is stripped rather than escaped, so the stored value stays clean HTML.
 *
 * Applied on **write**, not only at render. Angular's `DomSanitizer` also
 * sanitizes `[innerHTML]`, but the content API is public — sanitizing here
 * means it never serves untrusted markup to anything that consumes it,
 * browser or not.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "s",
    "code",
    "pre",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h2",
    "h3",
    "h4",
    "hr",
    "img",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title"],
    code: ["class"],
  },
  allowedClasses: { code: ["language-*"] },
  // Blocks javascript: and data: URLs, which are the usual way a link becomes
  // script execution.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  // Anything opening a new tab must not be able to reach back via window.opener.
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs["target"] ? { ...attribs, rel: "noreferrer noopener" } : attribs,
    }),
    code: (tagName, attribs) => {
      const cls = attribs["class"];
      const kept: sanitizeHtml.Attributes = cls && CODE_LANGUAGE.test(cls) ? { class: cls } : {};
      return { tagName, attribs: kept };
    },
  },
  // Images only from the media library: a body can neither hotlink nor track.
  exclusiveFilter: (frame) => frame.tag === "img" && !MEDIA_SRC.test(frame.attribs["src"] ?? ""),
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
  if (/^\s*<(p|ul|ol|h2|h3|h4|blockquote|pre)[\s>]/i.test(trimmed))
    return sanitizeRichText(trimmed);

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

/** The visible text of sanitized HTML, for reading time and search. */
export function htmlToText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(?:br|\/(?:p|li|h[2-4]|pre|blockquote))\b[^<>]*>/gi, "\n")
      .replace(/<[^<>]*>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The entities sanitize-html and Tiptap write. */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code: string) => {
      const lower = code.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "nbsp") return " ";
      const point = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    },
  );
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
