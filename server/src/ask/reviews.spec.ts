import { describe, expect, it } from "vitest";

import {
  buildQueue,
  isoWeek,
  labelStats,
  reviewReasons,
  sampleSize,
  weekBounds,
} from "./reviews.js";

describe("review weeks", () => {
  it("names the ISO week, including the ones that belong to the other year", () => {
    expect(isoWeek(new Date("2026-09-30T12:00:00Z"))).toBe("2026-W40");
    expect(isoWeek(new Date("2026-09-28T00:00:00Z"))).toBe("2026-W40");
    expect(isoWeek(new Date("2026-10-04T23:59:59Z"))).toBe("2026-W40");
    expect(isoWeek(new Date("2021-01-03T12:00:00Z"))).toBe("2020-W53");
    expect(isoWeek(new Date("2024-12-30T12:00:00Z"))).toBe("2025-W01");
  });

  it("gives a week's Monday-to-Monday bounds, and refuses a week that does not exist", () => {
    expect(weekBounds("2026-W40")).toEqual({
      start: new Date("2026-09-28T00:00:00Z"),
      end: new Date("2026-10-05T00:00:00Z"),
    });
    expect(weekBounds("2020-W53")?.start).toEqual(new Date("2020-12-28T00:00:00Z"));
    expect(weekBounds("2026-W53")?.start).toEqual(new Date("2026-12-28T00:00:00Z"));
    expect(weekBounds("2025-W53")).toBeNull();
    expect(weekBounds("2026-40")).toBeNull();
    expect(weekBounds("2026-W00")).toBeNull();
  });
});

describe("the review queue", () => {
  it("samples 5 %, at least 10 and at most 30, never more than there are", () => {
    expect(sampleSize(0)).toBe(0);
    expect(sampleSize(4)).toBe(4);
    expect(sampleSize(100)).toBe(10);
    expect(sampleSize(400)).toBe(20);
    expect(sampleSize(5_000)).toBe(30);
  });

  it("is the same for the same week, flagged answers first and each answer once", () => {
    const candidates = Array.from({ length: 300 }, (_, i) => ({
      id: `m_${String(i).padStart(9, "0")}`,
      reasons: i % 50 === 0 ? ["thumbs down"] : [],
    }));
    const first = buildQueue("2026-W40", candidates);
    expect(buildQueue("2026-W40", [...candidates].reverse())).toEqual(first);

    const flagged = first.filter((e) => e.reasons.length);
    expect(flagged).toHaveLength(6);
    expect(first.slice(0, 6)).toEqual(flagged);
    expect(first.filter((e) => e.sampled)).toHaveLength(sampleSize(300));
    expect(new Set(first.map((e) => e.id)).size).toBe(first.length);
    // Another week draws another sample.
    expect(buildQueue("2026-W41", candidates).map((e) => e.id)).not.toEqual(first.map((e) => e.id));
  });

  it("keeps an answer already reviewed when more answers move the sample", () => {
    const early = Array.from({ length: 10 }, (_, i) => ({ id: `m_${i}`, reasons: [] }));
    const later = [
      ...early,
      ...Array.from({ length: 190 }, (_, i) => ({ id: `n_${i}`, reasons: [] })),
    ];
    expect(buildQueue("2026-W40", early)).toHaveLength(10);
    const stillSampled = new Set(buildQueue("2026-W40", later).map((e) => e.id));
    const dropped = early.find((c) => !stillSampled.has(c.id));
    expect(dropped).toBeDefined();

    const queue = buildQueue(
      "2026-W40",
      later.map((c) => ({ ...c, reviewed: c.id === dropped!.id })),
    );
    expect(queue.filter((e) => e.sampled)).toHaveLength(10);
    expect(queue.find((e) => e.id === dropped!.id)).toEqual({
      id: dropped!.id,
      reasons: [],
      sampled: false,
    });
  });

  it("gives people's signals before the checks' flags", () => {
    expect(
      reviewReasons({ thumbsDown: true, unknown: true, flags: ["uncited", "language"] }),
    ).toEqual(["thumbs down", "didn't know", "check:uncited", "check:language"]);
    expect(reviewReasons({ thumbsDown: false, unknown: false, flags: [] })).toEqual([]);
  });
});

describe("label stats", () => {
  it("counts good and bad per label, skipping what did not apply", () => {
    expect(
      labelStats([
        { labels: { correct: true, grounded: false, helpful: true, tone: null, language: true } },
        { labels: { correct: true, grounded: true } },
      ]),
    ).toEqual({
      correct: { good: 2, bad: 0 },
      grounded: { good: 1, bad: 1 },
      helpful: { good: 1, bad: 0 },
      tone: { good: 0, bad: 0 },
      language: { good: 1, bad: 0 },
    });
  });
});
