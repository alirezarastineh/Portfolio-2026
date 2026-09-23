import {
  defineEventHandler,
  getRequestHeader,
  getRouterParam,
  sendNoContent,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import { isDocKind } from "../../../../../../../app/content/schema";
import { getDoc, isLocale } from "../../../../../../utils/content-upstream";

/**
 * One long-form doc — `/api/v2/content/en/legal/imprint`, a case study, a
 * post — through the same cache, validation and fallback as the core.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");
  const kind = getRouterParam(event, "kind");
  const slug = getRouterParam(event, "slug") ?? "";

  if (!isLocale(locale)) {
    setResponseStatus(event, 400);
    return { error: "unsupported_locale" };
  }
  if (!isDocKind(kind) || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    setResponseStatus(event, 404);
    return { error: "not_found" };
  }

  const result = await getDoc(locale, kind, slug);
  setResponseHeader(event, "X-Content-Source", result.source);

  if (result.payload === null) {
    setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=10");
    setResponseStatus(event, 404);
    return { error: "not_found" };
  }

  setResponseHeader(
    event,
    "Cache-Control",
    result.source === "fallback"
      ? "no-store"
      : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  );
  if (result.etag) {
    setResponseHeader(event, "ETag", result.etag);
    if (getRequestHeader(event, "if-none-match") === result.etag) {
      return sendNoContent(event, 304);
    }
  }
  return result.payload;
});
