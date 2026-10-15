import type { McpUsageRow } from "./assistant-types";

/**
 * What agents asked of the read-only MCP endpoint (plan phase 32), as the
 * Overview shows it: the calls over the period, the tools by use, and what
 * was refused. Pure.
 */

export interface McpSummary {
  /** Everything served: discovery, the handshake, the tool list, the tool calls. */
  calls: number;
  /** "search_portfolio 12 · get_document 4", most used first. */
  tools: string;
  refused: number;
  /** "rate_limited 3 · origin 1", most frequent first. */
  reasons: string;
}

function ranked(totals: Map<string, number>): string {
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ");
}

export function mcpSummary(rows: readonly McpUsageRow[]): McpSummary {
  const tools = new Map<string, number>();
  const reasons = new Map<string, number>();
  let calls = 0;
  let refused = 0;
  for (const row of rows) {
    if (row.name.startsWith("refused:")) {
      refused += row.count;
      const reason = row.name.slice("refused:".length);
      reasons.set(reason, (reasons.get(reason) ?? 0) + row.count);
      continue;
    }
    // A notification is acknowledged, not served.
    if (row.name === "notification") continue;
    calls += row.count;
    if (row.name.startsWith("tools/call:")) {
      const tool = row.name.slice("tools/call:".length);
      tools.set(tool, (tools.get(tool) ?? 0) + row.count);
    }
  }
  return { calls, tools: ranked(tools), refused, reasons: ranked(reasons) };
}
