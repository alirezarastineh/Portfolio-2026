/**
 * A social link's address as a person would say it: `github.com/alirezarastineh`
 * for a web profile (no scheme, `www.` or trailing slash), the address alone
 * for `mailto:`. Anything else comes back as it was.
 */
export function socialHandle(href: string): string {
  if (href.startsWith("mailto:")) return href.slice("mailto:".length).split("?")[0] ?? "";
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return href;
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return href;
  }
}

/** A web page opens in a new tab; `mailto:` and the like never should. */
export function isWebLink(href: string): boolean {
  return /^https?:/i.test(href);
}
