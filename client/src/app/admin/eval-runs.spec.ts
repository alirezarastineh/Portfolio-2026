import { describe, expect, it } from "vitest";

import type { EvalCaseResult, RunItem, RunRow } from "./assistant-types";
import { canResume, compareRuns, isActive, passCounts, progressShare } from "./eval-runs";

function run(overrides: Partial<RunRow> = {}): Pick<RunRow, "status" | "progress"> {
  return {
    status: "running",
    progress: { total: 4, done: 1, failed: 0, unavailable: 0 },
    ...overrides,
  };
}

function item(key: string, verdict: "passed" | "failed" | "unavailable" | null): RunItem {
  const result =
    verdict === null
      ? null
      : ({
          id: key,
          status: verdict,
          passed: verdict === "passed",
        } as EvalCaseResult);
  return {
    key,
    position: 0,
    status: verdict === null ? "pending" : verdict === "unavailable" ? "unavailable" : "done",
    result,
    attempts: 1,
    usd: 0,
    updatedAt: "2026-09-30T00:00:00Z",
  };
}

describe("eval runs", () => {
  it("knows a run that is still going, and one that can be picked up again", () => {
    expect(isActive(run())).toBe(true);
    expect(isActive(run({ status: "queued" }))).toBe(true);
    expect(isActive(run({ status: "done" }))).toBe(false);
    expect(canResume(run({ status: "interrupted" }))).toBe(true);
    expect(canResume(run({ status: "failed" }))).toBe(true);
    // Nothing left to do, or still running: no resume.
    expect(
      canResume(
        run({ status: "cancelled", progress: { total: 2, done: 2, failed: 0, unavailable: 0 } }),
      ),
    ).toBe(false);
    expect(canResume(run({ status: "running" }))).toBe(false);
  });

  it("measures progress by the items finished", () => {
    expect(progressShare(run())).toBe(0.25);
    expect(progressShare(run({ progress: { total: 0, done: 0, failed: 0, unavailable: 0 } }))).toBe(
      0,
    );
  });

  it("counts passes among the graded cases only", () => {
    expect(
      passCounts([
        item("a", "passed"),
        item("b", "failed"),
        item("c", "unavailable"),
        item("d", null),
      ]),
    ).toEqual({ passed: 1, graded: 2 });
  });

  it("compares two runs case by case, the flips first", () => {
    const a = [item("a", "passed"), item("b", "passed"), item("c", "failed"), item("d", null)];
    const b = [item("a", "passed"), item("b", "failed"), item("c", "failed"), item("e", "passed")];
    expect(compareRuns(a, b)).toEqual([
      { id: "b", a: "passed", b: "failed", changed: true },
      { id: "a", a: "passed", b: "passed", changed: false },
      { id: "c", a: "failed", b: "failed", changed: false },
      { id: "d", a: "not run", b: "not run", changed: false },
      { id: "e", a: "not run", b: "passed", changed: false },
    ]);
  });
});
