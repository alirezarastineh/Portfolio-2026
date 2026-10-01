import { beforeEach, describe, expect, it } from "vitest";

import {
  countGuardEvent,
  flushGuardEvents,
  pendingGuardEvents,
  type GuardEventRow,
} from "./guard-events.js";

beforeEach(async () => {
  await flushGuardEvents(async () => undefined);
});

describe("guard events", () => {
  it("gathers counts per UTC day and kind, and writes them in one go", async () => {
    const day = new Date("2026-09-30T23:59:00Z");
    countGuardEvent("rate_limited", day);
    countGuardEvent("rate_limited", day);
    countGuardEvent("honeypot", day);
    countGuardEvent("rate_limited", new Date("2026-10-01T00:01:00Z"));

    const writes: GuardEventRow[][] = [];
    await flushGuardEvents(async (rows) => {
      writes.push(rows);
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      { day: "2026-09-30", kind: "rate_limited", count: 2 },
      { day: "2026-09-30", kind: "honeypot", count: 1 },
      { day: "2026-10-01", kind: "rate_limited", count: 1 },
    ]);
    expect(pendingGuardEvents()).toEqual([]);
  });

  it("does not write when nothing was counted", async () => {
    let wrote = false;
    await flushGuardEvents(async () => {
      wrote = true;
    });
    expect(wrote).toBe(false);
  });

  it("keeps the counts when the write fails, added to what came in meanwhile", async () => {
    const day = new Date("2026-09-30T12:00:00Z");
    countGuardEvent("busy", day);
    await expect(
      flushGuardEvents(async () => {
        countGuardEvent("busy", day);
        throw new Error("database down");
      }),
    ).rejects.toThrow("database down");
    expect(pendingGuardEvents()).toEqual([{ day: "2026-09-30", kind: "busy", count: 2 }]);
  });
});
