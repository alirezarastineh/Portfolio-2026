import { describe, expect, it } from "vitest";

import type { ConversationRow, ReviewEntry } from "./assistant-types";
import { cycleLabel, emptyLabels, goodShare, nextUnreviewed } from "./review-queue";

function entry(id: string, reviewed: boolean): ReviewEntry {
  return {
    message: { id } as ConversationRow,
    reasons: [],
    sampled: true,
    review: reviewed
      ? { labels: emptyLabels(), note: null, reviewedAt: "2026-09-30T00:00:00Z" }
      : null,
  };
}

describe("the review queue", () => {
  it("cycles a label through good, not good and does not apply", () => {
    expect(cycleLabel(null)).toBe(true);
    expect(cycleLabel(true)).toBe(false);
    expect(cycleLabel(false)).toBeNull();
    expect(Object.values(emptyLabels()).every((v) => v === null)).toBe(true);
  });

  it("goes to the next answer still to review, wrapping round once", () => {
    const queue = [entry("a", false), entry("b", true), entry("c", false), entry("d", true)];
    expect(nextUnreviewed(queue, null)?.message.id).toBe("a");
    expect(nextUnreviewed(queue, "a")?.message.id).toBe("c");
    expect(nextUnreviewed(queue, "c")?.message.id).toBe("a");
    expect(nextUnreviewed([entry("a", true)], "a")).toBeNull();
  });

  it("gives each label's share of good verdicts, or nothing yet", () => {
    expect(goodShare({ good: 3, bad: 1 })).toBe(0.75);
    expect(goodShare({ good: 0, bad: 0 })).toBeNull();
  });
});
