import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from "h3";

import type { AppContent } from "../../../app/content/schema";
import { getContent, isLocale, siteOriginOf } from "../../utils/content-upstream";
import { buildRss } from "../../utils/rss";

const FALLBACK_ORIGIN = "https://alirezarastineh.me";

/** `/en/rss.xml`: this language's posts, newest first. */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");
  if (!isLocale(locale)) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const { payload } = await getContent(locale);
  const content = payload as AppContent;

  setResponseHeader(event, "Content-Type", "application/rss+xml; charset=utf-8");
  // Feed readers poll; a post appearing a few minutes late is fine.
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=900");
  return buildRss(content, siteOriginOf(payload, FALLBACK_ORIGIN));
});
