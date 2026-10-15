import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";

import type { AppContent } from "../../app/content/schema";
import { getContent, siteOriginOf } from "../utils/content-upstream";
import { buildLlmsTxt, mcpEndpoint } from "../utils/llms";

/**
 * `/llms.txt`, where the convention looks first: the English index, which links
 * the German one (`/de/llms.txt`).
 */
export default defineEventHandler(async (event) => {
  const { payload } = await getContent("en");
  setResponseHeader(event, "Content-Type", "text/plain; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");
  return buildLlmsTxt(
    payload as AppContent,
    siteOriginOf(payload, getRequestURL(event).origin),
    mcpEndpoint(process.env),
  );
});
