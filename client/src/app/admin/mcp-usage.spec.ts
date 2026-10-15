import { describe, expect, it } from "vitest";

import { mcpSummary } from "./mcp-usage";

describe("what agents asked over MCP (plan phase 32)", () => {
  it("sums the calls, ranks the tools by use, and keeps refusals apart", () => {
    expect(
      mcpSummary([
        { day: "2026-10-12", name: "server/discover", count: 2 },
        { day: "2026-10-12", name: "tools/list", count: 2 },
        { day: "2026-10-12", name: "tools/call:get_document", count: 3 },
        { day: "2026-10-13", name: "tools/call:search_portfolio", count: 5 },
        { day: "2026-10-13", name: "tools/call:get_document", count: 2 },
        { day: "2026-10-13", name: "notification", count: 1 },
        { day: "2026-10-13", name: "refused:rate_limited", count: 4 },
        { day: "2026-10-13", name: "refused:origin", count: 1 },
      ]),
    ).toEqual({
      calls: 14,
      tools: "get_document 5 · search_portfolio 5",
      refused: 5,
      reasons: "rate_limited 4 · origin 1",
    });
  });

  it("says nothing was asked when nothing was", () => {
    expect(mcpSummary([])).toEqual({ calls: 0, tools: "", refused: 0, reasons: "" });
  });
});
