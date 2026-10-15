import { defineEventHandler, getRequestURL, setResponseHeader } from "h3";

import type { AppContent } from "../../../app/content/schema";
import { buildAgentCard } from "../../utils/agent-card";
import { getContent, siteOriginOf } from "../../utils/content-upstream";
import { mcpEndpoint } from "../../utils/llms";

/** `/.well-known/agent-card.json`: the portfolio assistant's A2A agent card (plan phase 32). */
export default defineEventHandler(async (event) => {
  const { payload } = await getContent("en");
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "Cache-Control", "public, max-age=0, s-maxage=3600");
  return JSON.stringify(
    buildAgentCard(
      payload as AppContent,
      siteOriginOf(payload, getRequestURL(event).origin),
      mcpEndpoint(process.env),
    ),
  );
});
