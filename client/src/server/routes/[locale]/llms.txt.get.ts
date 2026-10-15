import {
  defineEventHandler,
  getRequestURL,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from "h3";

import type { AppContent } from "../../../app/content/schema";
import { getContent, isLocale, siteOriginOf } from "../../utils/content-upstream";
import { buildLlmsTxt, mcpEndpoint } from "../../utils/llms";

/** `/en/llms.txt`: the portfolio as an index for language models, in this language (llmstxt.org). */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, "locale");
  if (!isLocale(locale)) {
    setResponseStatus(event, 404);
    return "Not found";
  }

  const { payload } = await getContent(locale);
  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");
  return buildLlmsTxt(
    payload as AppContent,
    siteOriginOf(payload, getRequestURL(event).origin),
    mcpEndpoint(process.env),
  );
});
