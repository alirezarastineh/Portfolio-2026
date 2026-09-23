import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  sendNoContent,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { getContent, isLocale } from "../../../../utils/content-upstream";

/**
 * The published core for one locale. This route exists because
 * `API_INTERNAL_BASE_URL` is only readable from Nitro code — Vite inlines
 * `process.env` into the Angular SSR bundle at build time, so an Angular
 * service literally cannot see it.
 *
 * It also makes the client's fetch URL identical on server and browser, which
 * is what activates Angular's HTTP transfer cache.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");

  if (!isLocale(locale)) {
    setResponseStatus(event, 400);
    return { error: "unsupported_locale" };
  }

  const result = await getContent(locale);

  setResponseHeader(event, "X-Content-Source", result.source);
  setResponseHeader(
    event,
    "Cache-Control",
    result.source === "fallback"
      ? "no-store"
      : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );

  if (result.etag) {
    setResponseHeader(event, "ETag", result.etag);
    // The browser revalidates (max-age=0); an unchanged payload costs a 304.
    if (getRequestHeader(event, "if-none-match") === result.etag) {
      return sendNoContent(event, 304);
    }
  }

  return result.payload;
});
