import { beforeEach, describe, expect, it } from "vitest";

import { countMcp, flushMcpUsage, pendingMcpUsage, type McpUsageRow } from "./usage.js";

/** Plan phase 32: a flush that fails loses no count. */

const DAY = new Date("2026-10-14T12:00:00Z");

beforeEach(async () => {
  // Counts another test left in memory.
  await flushMcpUsage(async () => {});
});

const counted = (rows: McpUsageRow[]) =>
  rows.map((r) => `${r.day} ${r.name} ${r.count}`).sort((a, b) => a.localeCompare(b));

describe("flushMcpUsage", () => {
  it("keeps what a failed write held, with what was counted meanwhile, and says it failed", async () => {
    countMcp("tools/list", DAY);
    countMcp("tools/list", DAY);
    countMcp("refused:origin", DAY);

    await expect(
      flushMcpUsage(async () => {
        // Counted while the write is on its way.
        countMcp("tools/list", DAY);
        throw new Error("the database is down");
      }),
    ).rejects.toThrow("the database is down");
    expect(counted(pendingMcpUsage())).toEqual([
      "2026-10-14 refused:origin 1",
      "2026-10-14 tools/list 3",
    ]);

    // The next flush writes them all, once.
    const written: McpUsageRow[] = [];
    await flushMcpUsage(async (rows) => {
      written.push(...rows);
    });
    expect(counted(written)).toEqual(["2026-10-14 refused:origin 1", "2026-10-14 tools/list 3"]);
    expect(pendingMcpUsage()).toEqual([]);
  });

  it("writes nothing when nothing was counted", async () => {
    let writes = 0;
    await flushMcpUsage(async () => {
      writes++;
    });
    expect(writes).toBe(0);
  });
});
