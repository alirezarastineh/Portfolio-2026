import { sql } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { aiMcpUsage } from "../../db/schema.js";
import { utcDay } from "../guard.js";
import { MCP_TOOL_NAMES } from "./tools.js";

/**
 * What the MCP endpoint served and refused (plan phase 32), counted per UTC
 * day and name, as `guard-events.ts` counts the assistant's refusals: in
 * memory, written once a minute and at shutdown, so a flood costs one upsert
 * per name. The names come from a fixed set (a client's own method names are
 * never stored), so the table cannot grow with what a client invents. A crash
 * loses at most a minute of counts.
 */

const REFUSALS = [
  "rate_limited",
  "origin",
  "invalid",
  "too_large",
  "header_mismatch",
  "unsupported_version",
  "unknown_method",
  "unknown_tool",
] as const;

export const MCP_USAGE_NAMES = [
  "initialize",
  "server/discover",
  "ping",
  "tools/list",
  ...MCP_TOOL_NAMES.map((tool) => `tools/call:${tool}` as const),
  "notification",
  ...REFUSALS.map((reason) => `refused:${reason}` as const),
] as const;

export type McpUsageName = (typeof MCP_USAGE_NAMES)[number];
export type McpRefusal = (typeof REFUSALS)[number];

export interface McpUsageRow {
  day: string;
  name: McpUsageName;
  count: number;
}

const pending = new Map<string, McpUsageRow>();

export function countMcp(name: McpUsageName, at = new Date()): void {
  const day = utcDay(at);
  const key = `${day}|${name}`;
  const row = pending.get(key);
  if (row) row.count++;
  else pending.set(key, { day, name, count: 1 });
}

async function upsert(rows: McpUsageRow[]): Promise<void> {
  await getDb()
    .insert(aiMcpUsage)
    .values(rows)
    .onConflictDoUpdate({
      target: [aiMcpUsage.day, aiMcpUsage.name],
      set: { count: sql`${aiMcpUsage.count} + excluded.count` },
    });
}

/** Writes what has gathered. Counts that fail to write are kept for the next flush. */
export async function flushMcpUsage(write = upsert): Promise<void> {
  if (!pending.size) return;
  const rows = [...pending.values()];
  pending.clear();
  try {
    await write(rows);
  } catch (error) {
    for (const row of rows) {
      const key = `${row.day}|${row.name}`;
      const since = pending.get(key);
      pending.set(key, { ...row, count: row.count + (since?.count ?? 0) });
    }
    throw error;
  }
}

/** Counted but not yet written (tests). */
export function pendingMcpUsage(): McpUsageRow[] {
  return [...pending.values()].map((row) => ({ ...row }));
}

let timer: NodeJS.Timeout | undefined;

export function startMcpUsageFlush(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void flushMcpUsage().catch((error: unknown) =>
      console.error("[mcp] usage counts not written", error),
    );
  }, intervalMs);
  timer.unref?.();
}
