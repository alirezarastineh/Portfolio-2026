/** A web page opens in a new tab; `mailto:` and the like never should. */
export function isWebLink(href: string): boolean {
  return /^https?:/i.test(href);
}
