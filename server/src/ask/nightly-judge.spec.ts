import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import {
  isFlagged,
  nextNightlyJudgeAt,
  NIGHTLY_RULES,
  pickNightly,
  previousDay,
  sampleCount,
  startNightlyJudge,
  stopNightlyJudge,
} from "./nightly-judge.js";

/**
 * Plan phase 26: which answers a night judges, and when. Pure, apart from the
 * schedule's fake timers.
 */

const candidates = (n: number, flagged: (i: number) => boolean = () => false) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m_night${String(i).padStart(4, "0")}`,
    flagged: flagged(i),
  }));

describe("the night's picks", () => {
  it("draws 5 % of the day's answers, at least 3, all of them when fewer", () => {
    expect(sampleCount(0)).toBe(0);
    expect(sampleCount(2)).toBe(2);
    expect(sampleCount(10)).toBe(3);
    expect(sampleCount(100)).toBe(5);
    expect(sampleCount(1000)).toBe(50);
    expect(pickNightly("2026-10-06", candidates(2))).toEqual([
      { id: expect.any(String), pick: "sample" },
      { id: expect.any(String), pick: "sample" },
    ]);
  });

  it("adds every flagged answer the sample did not draw, the sample first, at most 40", () => {
    const day = candidates(100, (i) => i % 10 === 0);
    const picks = pickNightly("2026-10-06", day);
    const sampled = picks.filter((p) => p.pick === "sample");
    expect(sampled).toHaveLength(5);
    // Ten flagged answers: those the sample drew stay "sample", the rest follow it.
    const flagged = day.filter((c) => c.flagged).map((c) => c.id);
    const drawnFlagged = sampled.filter((p) => flagged.includes(p.id)).length;
    expect(picks.filter((p) => p.pick === "flagged")).toHaveLength(10 - drawnFlagged);
    expect(picks.findIndex((p) => p.pick === "flagged")).toBe(5);
    expect(new Set(picks.map((p) => p.id)).size).toBe(picks.length);

    const busy = pickNightly(
      "2026-10-06",
      candidates(1000, (i) => i % 2 === 0),
    );
    expect(busy).toHaveLength(NIGHTLY_RULES.max);
    // 50 drawn, so the cap leaves none of the flagged ones beyond the sample.
    expect(busy.every((p) => p.pick === "sample")).toBe(true);
  });

  it("draws the same answers for the same day, others for another", () => {
    const day = candidates(200);
    const once = pickNightly("2026-10-06", day).map((p) => p.id);
    expect(pickNightly("2026-10-06", [...day].reverse()).map((p) => p.id)).toEqual(once);
    expect(pickNightly("2026-10-07", day).map((p) => p.id)).not.toEqual(once);
  });

  it("flags an answer by its own flags or a thumbs-down, never by the question's", () => {
    expect(isFlagged([], false)).toBe(false);
    expect(isFlagged(["uncited"], false)).toBe(true);
    expect(isFlagged([], true)).toBe(true);
    expect(isFlagged(["injection-attempt"], false)).toBe(false);
  });

  it("judges the UTC day before", () => {
    expect(previousDay(new Date("2026-10-07T02:30:00Z"))).toEqual({
      day: "2026-10-06",
      start: new Date("2026-10-06T00:00:00Z"),
      end: new Date("2026-10-07T00:00:00Z"),
    });
    expect(previousDay(new Date("2026-03-01T00:10:00Z")).day).toBe("2026-02-28");
  });
});

describe("the nightly schedule", () => {
  afterEach(() => {
    stopNightlyJudge();
    vi.useRealTimers();
  });

  it("starts at 02:30 UTC, before the trust check, and not while the deploy has the assistant off", async () => {
    expect(nextNightlyJudgeAt(new Date("2026-10-07T02:29:00Z")).toISOString()).toBe(
      "2026-10-07T02:30:00.000Z",
    );
    expect(nextNightlyJudgeAt(new Date("2026-10-07T02:30:00Z")).toISOString()).toBe(
      "2026-10-08T02:30:00.000Z",
    );
    vi.useFakeTimers();
    const start = vi.fn(async () => ({ refused: "feature_off" }));
    let config = fixtureConfig();
    startNightlyJudge({ now: new Date("2026-10-07T02:00:00Z"), start, config: () => config });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(start).toHaveBeenCalledTimes(1);
    config = fixtureConfig({ enabled: false });
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(start).toHaveBeenCalledTimes(1);
    config = fixtureConfig();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("logs a failed start and tries again the next night", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const start = vi.fn(async () => {
      throw new Error("the database is down");
    });
    startNightlyJudge({
      now: new Date("2026-10-07T02:29:00Z"),
      start,
      config: () => fixtureConfig(),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logged).toHaveBeenCalledWith("[judge] nightly start failed", expect.any(Error));
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(start).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
