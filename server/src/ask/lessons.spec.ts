import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import {
  nextLearningCheckAt,
  startLearningMonitor,
  stopLearningMonitor,
} from "./learning-monitor.js";
import {
  cleanScope,
  corroborationProblem,
  evictionReason,
  failed,
  inScope,
  lessonEffect,
  triggerVerdict,
} from "./lessons.js";
import type { OutcomeRow } from "./outcomes.js";

/**
 * Plan phase 25: the adaptive trigger, a lesson's scope and effect, eviction
 * and corroboration. Pure.
 */

const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let n = 0;
function row(over: Partial<OutcomeRow> = {}): OutcomeRow {
  n++;
  return {
    id: `m_lesson${String(n).padStart(4, "0")}`,
    sessionHash: `s${n}`,
    createdAt: new Date(NOW.getTime() - n * 60_000),
    question: "Does he need a visa to work in Germany?",
    finishReason: "stop",
    usd: 0.001,
    flags: [],
    feedback: null,
    faithfulness: null,
    unknown: false,
    handoffOffered: false,
    handoffConfirmed: false,
    ...over,
  };
}

const runs = (failures: number, ok: number) => [
  ...Array.from({ length: failures }, () => true),
  ...Array.from({ length: ok }, () => false),
];

describe("a failed answer", () => {
  it("is one that did not help, or said it isn't there", () => {
    const none = new Set<string>();
    expect(failed(row(), none)).toBe(false);
    expect(failed(row({ unknown: true }), none)).toBe(true);
    expect(failed(row({ feedback: -1 }), none)).toBe(true);
    expect(failed(row({ flags: ["uncited"] }), none)).toBe(true);
    expect(failed(row({ finishReason: "error:timeout" }), none)).toBe(true);
    // A flag on the question says nothing about the answer.
    expect(failed(row({ flags: ["injection-attempt"] }), none)).toBe(false);
    const asked = row();
    expect(failed(asked, new Set([asked.id]))).toBe(true);
  });
});

describe("the adaptive trigger", () => {
  // Newest first: the last 30, then the 30 before.
  const spike = [...runs(9, 21), ...runs(4, 26)];

  it("fires when the last 30 fail more than 1.5 times the 30 before", () => {
    const verdict = triggerVerdict(spike, 12);
    expect(verdict).toMatchObject({
      fire: true,
      recent: { answers: 30, failed: 9 },
      previous: { answers: 30, failed: 4 },
      lastFailed: 9,
    });
    expect(verdict.reason).toBe(
      "failures rose: the last 30: 9 failed; the 30 before: 4 failed; 12 new since the last insights",
    );
  });

  it("waits for 60 answers, 10 new ones, a real rise, and 2 failures in the last 20", () => {
    expect(triggerVerdict(spike.slice(0, 59), 12)).toMatchObject({
      fire: false,
      reason: "59 answers kept; 60 needed",
    });
    expect(triggerVerdict(spike, 9)).toMatchObject({
      fire: false,
      reason: "9 new answers since the last insights; 10 needed",
    });
    // 6 against 4: exactly 1.5 times is no rise.
    expect(triggerVerdict([...runs(6, 24), ...runs(4, 26)], 12).fire).toBe(false);
    expect(triggerVerdict([...runs(7, 23), ...runs(4, 26)], 12).fire).toBe(true);
    // The rise sits in the last 30 but not the last 20.
    const late = [...runs(0, 20), ...runs(3, 7), ...runs(0, 30)];
    expect(triggerVerdict(late, 12)).toMatchObject({
      fire: false,
      reason: "0 failed among the last 20; 2 needed",
    });
  });

  it("fires on any two recent failures after a clean stretch", () => {
    expect(triggerVerdict([...runs(2, 28), ...runs(0, 30)], 10).fire).toBe(true);
    expect(triggerVerdict([...runs(1, 29), ...runs(0, 30)], 10).fire).toBe(false);
  });
});

describe("a lesson's scope and effect", () => {
  it("keeps clean words, and matches questions by stem, never inside another word", () => {
    expect(cleanScope([" Visa ", "visa", "work-permit", "ab", "Arbeitserlaubnis"])).toEqual([
      "visa",
      "arbeitserlaubnis",
    ]);
    expect(cleanScope(Array.from({ length: 20 }, (_, i) => `word${i}`))).toHaveLength(12);
    expect(inScope("Does he need a visa?", ["visa"])).toBe(true);
    expect(inScope("Is he relocating to Berlin?", ["relocation"])).toBe(true);
    expect(inScope("Which Visa payments did Atlas support?", ["visas"])).toBe(true);
    expect(inScope("Did he use Atlassian?", ["atlas"])).toBe(false);
    expect(inScope("Anything?", [])).toBe(false);
  });

  it("compares the 30 days before the fix with the time since, on matching answers only", () => {
    const applied = new Date(NOW.getTime() - 5 * DAY);
    const at = (days: number) => new Date(applied.getTime() + days * DAY);
    const rows = [
      // Before: three unknown, one with a thumbs-down.
      row({ createdAt: at(-2), unknown: true }),
      row({ createdAt: at(-3), unknown: true }),
      row({ createdAt: at(-4), unknown: true, feedback: -1 }),
      // Too long before, and off-topic: neither counts.
      row({ createdAt: at(-40), unknown: true }),
      row({ createdAt: at(-1), question: "Which databases does he use?", unknown: true }),
      // Since: four good, one unknown.
      ...[1, 2, 3, 4].map((d) => row({ createdAt: at(d) })),
      row({ createdAt: at(4.5), unknown: true }),
    ];
    const effect = lessonEffect(rows, ["visa"], applied, NOW);
    expect(effect).toEqual({
      at: NOW.toISOString(),
      since: applied.toISOString(),
      before: { answers: 3, unknown: 3, down: 1, failed: 3 },
      after: { answers: 5, unknown: 1, down: 0, failed: 1 },
      applications: 5,
      successes: 4,
      value: 0.8,
    });
    expect(evictionReason(effect)).toBeNull();
  });

  it("measures a reopened lesson on the answers since the reopening only", () => {
    const applied = new Date(NOW.getTime() - 10 * DAY);
    const reopened = new Date(NOW.getTime() - 3 * DAY);
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
    const rows = [
      // Before the fix: counted as before.
      row({ createdAt: at(12), unknown: true }),
      // Between the fix and the reopening: the answers that retired it, in neither.
      ...[9, 8, 7, 6, 5].map((d) => row({ createdAt: at(d), unknown: true })),
      // Since the reopening.
      row({ createdAt: at(2) }),
      row({ createdAt: at(1), unknown: true }),
    ];
    const effect = lessonEffect(rows, ["visa"], applied, NOW, reopened);
    expect(effect).toMatchObject({
      since: reopened.toISOString(),
      before: { answers: 1, failed: 1 },
      after: { answers: 2, failed: 1 },
      applications: 2,
      value: 0.5,
    });
    expect(evictionReason(effect)).toBeNull();
    // A reopening before the fix (an older one) changes nothing.
    expect(lessonEffect(rows, ["visa"], applied, NOW, at(30)).applications).toBe(7);
  });

  it("retires a lesson below 0.5 after 5 applications, never before", () => {
    expect(evictionReason({ applications: 5, value: 0.4 })).toBe(
      "effectiveness 0.40 after 5 applications (floor 0.5)",
    );
    expect(evictionReason({ applications: 4, value: 0 })).toBeNull();
    expect(evictionReason({ applications: 5, value: 0.5 })).toBeNull();
    expect(evictionReason({ applications: 0, value: null })).toBeNull();
  });
});

describe("corroboration", () => {
  it("needs three decided journal entries, or an unanswered topic of five questions", () => {
    const decided = { status: "accepted" };
    expect(corroborationProblem({ source: "journal", entries: [decided, decided] })).toBe(
      "a lesson needs 3 accepted or fixed journal entries; 2 given",
    );
    // Every entry must be decided: three decided and an undecided one are refused.
    expect(
      corroborationProblem({
        source: "journal",
        entries: [decided, decided, { status: "fixed" }, { status: "proposed" }],
      }),
    ).toBe("every journal entry of a lesson must be accepted or fixed; 1 is not");
    expect(
      corroborationProblem({ source: "journal", entries: [decided, decided, { status: "fixed" }] }),
    ).toBeNull();
    expect(
      corroborationProblem({ source: "insight", topic: { questions: 9, unanswered: false } }),
    ).toBe("the topic is not one the assistant could not answer");
    expect(
      corroborationProblem({ source: "insight", topic: { questions: 4, unanswered: true } }),
    ).toBe("the topic has 4 questions; 5 needed");
    expect(
      corroborationProblem({ source: "insight", topic: { questions: 5, unanswered: true } }),
    ).toBeNull();
  });
});

describe("the nightly learning check", () => {
  afterEach(() => {
    stopLearningMonitor();
    vi.useRealTimers();
  });

  it("runs at 03:30 UTC, after the trust check, and not while the deploy has the assistant off", async () => {
    expect(nextLearningCheckAt(new Date("2026-10-07T03:29:00Z")).toISOString()).toBe(
      "2026-10-07T03:30:00.000Z",
    );
    expect(nextLearningCheckAt(new Date("2026-10-07T03:30:00Z")).toISOString()).toBe(
      "2026-10-08T03:30:00.000Z",
    );
    vi.useFakeTimers();
    const check = vi.fn(async () => null);
    const prune = vi.fn(async () => undefined);
    let config = fixtureConfig();
    startLearningMonitor({
      now: new Date("2026-10-07T03:00:00Z"),
      check,
      prune,
      config: () => config,
    });
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    config = fixtureConfig({ enabled: false });
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(1);
    // The insights runs quote visitors: they are pruned whatever the assistant's state.
    expect(prune).toHaveBeenCalledTimes(2);
    config = fixtureConfig();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("logs a failed check and tries again the next night", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const check = vi.fn(async () => {
      throw new Error("the database is down");
    });
    startLearningMonitor({
      now: new Date("2026-10-07T03:29:00Z"),
      check,
      prune: async () => undefined,
      config: () => fixtureConfig(),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logged).toHaveBeenCalledWith("[learning] check failed", expect.any(Error));
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
