import { describe, expect, it } from "vitest";

import type { ConversationRow, ReviewEntry, ReviewLabels } from "./assistant-types";
import {
  goodShare,
  isEmptyReview,
  nextUnreviewed,
  sameDraft,
  savedDraft,
  sharesLine,
  toLabels,
  weekOf,
  weekWords,
} from "./review-queue";

const OPEN: ReviewLabels = {
  correct: null,
  grounded: null,
  helpful: null,
  tone: null,
  language: null,
};

function entry(id: string, reviewed: boolean, labels: ReviewLabels = OPEN): ReviewEntry {
  return {
    message: { id } as ConversationRow,
    reasons: [],
    sampled: true,
    review: reviewed ? { labels, note: null, reviewedAt: "2026-09-30T00:00:00Z" } : null,
  };
}

describe("the review queue", () => {
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
    const none = { good: 0, bad: 0 };
    expect(
      sharesLine({
        correct: { good: 11, bad: 1 },
        grounded: none,
        helpful: none,
        tone: { good: 2, bad: 0 },
        language: none,
      }),
    ).toBe(
      "Correct 92 %, Grounded in the cited documents none yet, Helpful none yet, Tone 100 %, Language none yet",
    );
  });
});

describe("a review's draft", () => {
  it("presses nothing in advance on a fresh answer, and what was saved on a reviewed one", () => {
    expect(savedDraft(entry("a", false))).toEqual({ labels: {}, note: "" });
    const saved = { ...OPEN, correct: true, tone: false };
    expect(savedDraft(entry("a", true, saved))).toEqual({ labels: saved, note: "" });
  });

  it("knows a draft that says nothing from one that says something", () => {
    expect(isEmptyReview({ labels: {}, note: " \n" })).toBe(true);
    expect(isEmptyReview({ labels: {}, note: "Wrong tone." })).toBe(false);
    // "Does not apply" is a verdict once picked.
    expect(isEmptyReview({ labels: { tone: null }, note: "" })).toBe(false);
  });

  it("sends a verdict left open as does not apply", () => {
    expect(toLabels({ labels: { correct: true, grounded: false }, note: "" })).toEqual({
      ...OPEN,
      correct: true,
      grounded: false,
    });
  });

  it("compares two drafts verdict by verdict and by note", () => {
    const a = { labels: { correct: true }, note: "x" };
    expect(sameDraft(a, { labels: { correct: true }, note: "x" })).toBe(true);
    expect(sameDraft(a, { labels: { correct: false }, note: "x" })).toBe(false);
    expect(sameDraft(a, { labels: { correct: true }, note: "y" })).toBe(false);
    // Picked "does not apply" is not the same as not picked.
    expect(sameDraft({ labels: { tone: null }, note: "" }, { labels: {}, note: "" })).toBe(false);
  });
});

describe("the week in words", () => {
  it("names the week and its Monday to Sunday", () => {
    expect(weekWords("2026-W45")).toMatch(/^Week 45 of 2026 \(2\s–\s8 November\)$/u);
    expect(weekWords("2026-W40")).toMatch(/^Week 40 of 2026 \(28 September\s–\s4 October\)$/u);
  });

  it("gives the years when the week spans two, and leaves a week it cannot read as it came", () => {
    expect(weekWords("2026-W01")).toMatch(
      /^Week 1 of 2026 \(29 December 2025\s–\s4 January 2026\)$/u,
    );
    expect(weekWords("2020-W53")).toMatch(
      /^Week 53 of 2020 \(28 December 2020\s–\s3 January 2021\)$/u,
    );
    expect(weekWords("next week")).toBe("next week");
    expect(weekOf("2026-W05")).toBe("week 5");
    expect(weekOf("next week")).toBe("this week");
  });
});
