import { beforeEach, describe, expect, it } from "vitest";

import {
  countGuardEvent,
  flushGuardEvents,
  GUARD_EVENT_KINDS,
  pendingGuardEvents,
  REFUSAL_KINDS,
  type GuardEventRow,
} from "./guard-events.js";

const sorted = (items: readonly string[]) =>
  items.toSorted((a, b) => {
    if (a < b) {
      return -1;
    }
    return a > b ? 1 : 0;
  });

beforeEach(async () => {
  await flushGuardEvents(() => Promise.resolve());
});

describe("guard events", () => {
  it("gathers counts per UTC day and kind, and writes them in one go", async () => {
    const day = new Date("2026-09-30T23:59:00Z");
    countGuardEvent("rate_limited", day);
    countGuardEvent("rate_limited", day);
    countGuardEvent("honeypot", day);
    countGuardEvent("rate_limited", new Date("2026-10-01T00:01:00Z"));

    const writes: GuardEventRow[][] = [];
    await flushGuardEvents((rows) => {
      writes.push(rows);
      return Promise.resolve();
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
    await flushGuardEvents(() => {
      wrote = true;
      return Promise.resolve();
    });
    expect(wrote).toBe(false);
  });

  it("keeps the counts when the write fails, added to what came in meanwhile", async () => {
    const day = new Date("2026-09-30T12:00:00Z");
    countGuardEvent("busy", day);
    await expect(
      flushGuardEvents(() => {
        countGuardEvent("busy", day);
        return Promise.reject(new Error("database down"));
      }),
    ).rejects.toThrow("database down");
    expect(pendingGuardEvents()).toEqual([{ day: "2026-09-30", kind: "busy", count: 2 }]);
  });

  it("counts a visitor's forget beside the refusals, never as one (visitor plan V13, V14)", () => {
    expect(GUARD_EVENT_KINDS).toContain("forgotten");
    expect(REFUSAL_KINDS).not.toContain("forgotten");
    expect(sorted([...REFUSAL_KINDS, "forgotten"])).toEqual(sorted(GUARD_EVENT_KINDS));
  });
});
