/**
 * A shared question (visitor plan V17): a link with `?ask=<question>` opens the
 * assistant with that question in the prompt, unsent; only the visitor sends
 * it. index.html's `ask-link` script lifts the parameter out of the address
 * before analytics or the app reads it, and leaves the raw value on
 * `window.__askFromLink`; this takes it once, cleaned. Loaded with the page.
 */

/** The longest question a link may carry: the terminal's own limit. */
export const ASK_LINK_CHARS = 600;

/** Control characters and the bidi overrides that could make the prompt read backwards. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/** A question as the prompt takes it: no control characters, trimmed, at most 600 characters. */
export function cleanLinkQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(UNSAFE, "").replace(/\r\n?/g, "\n").trim().slice(0, ASK_LINK_CHARS);
  return text.trim() || null;
}

/** The question a link carried, once: the next call finds nothing. */
export function takeLinkQuestion(
  holder: { __askFromLink?: unknown } = globalThis as { __askFromLink?: unknown },
): string | null {
  const raw = holder.__askFromLink;
  delete holder.__askFromLink;
  return cleanLinkQuestion(raw);
}

/** The address to share: this page, without its query or hash, carrying the question. */
export function shareLink(origin: string, path: string, question: string): string {
  const page = path.split(/[?#]/, 1)[0] || "/";
  return `${origin}${page}?ask=${encodeURIComponent(question.slice(0, ASK_LINK_CHARS))}`;
}
