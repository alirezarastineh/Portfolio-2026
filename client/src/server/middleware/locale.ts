import { defineEventHandler, getRequestHeader, sendRedirect, setResponseHeader } from "h3";

import { localeRedirect } from "../../app/content/locale";

/**
 * Runs before rendering, for every request:
 *
 * - `/` → 302 to the visitor's language (cookie, then Accept-Language). Not
 *   cacheable by anyone else, and it varies with both headers. The browser
 *   keeps a `#fragment` across the redirect, so old `/#projects` links work.
 * - `/EN`, `/de/`, retired routes → 301 to the canonical address.
 *
 * Everything else — pages, `/api`, `/admin`, `/media`, assets — passes through
 * untouched (`localeRedirect` returns null).
 */
export default defineEventHandler(async (event) => {
  const redirect = localeRedirect(
    event.path,
    getRequestHeader(event, "cookie"),
    getRequestHeader(event, "accept-language"),
  );
  if (!redirect) return;

  if (redirect.negotiated) {
    setResponseHeader(event, "Vary", "Cookie, Accept-Language");
    setResponseHeader(event, "Cache-Control", "private, no-store");
  }
  await sendRedirect(event, redirect.location, redirect.status);

  // In dev, Analog only stops its middleware chain on a returned value; in
  // production h3 sees the response already sent and ignores it.
  return true;
});
