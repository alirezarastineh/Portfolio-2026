import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { EvalCaseResult, RunItem, RunRow } from "./assistant-types";
import {
  canResume,
  categoryLine,
  compareRuns,
  conversationLine,
  EVAL_SUITE_CASES,
  isActive,
  judgedLine,
  judgeScores,
  passCounts,
  progressShare,
  resultWord,
  seconds,
  statusWord,
} from "./eval-runs";

const here = dirname(fileURLToPath(import.meta.url));

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
  let status: RunItem["status"] = "done";
  if (verdict === null) {
    status = "pending";
  } else if (verdict === "unavailable") {
    status = "unavailable";
  }
  return {
    key,
    position: 0,
    status,
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

  it("sums up a conversation case's earlier turns and what the history did", () => {
    const turn = { question: "What did Atlas achieve?", answer: "38% fewer escalations." };
    expect(conversationLine({ turns: [turn], droppedAnswers: 0, windowDropped: 0 })).toBe(
      "after 1 earlier turn",
    );
    expect(
      conversationLine({
        turns: [turn, { ...turn, forged: true }, { ...turn, live: true }],
        droppedAnswers: 1,
        windowDropped: 2,
      }),
    ).toBe("after 3 earlier turns, 1 answered live, 1 answer refused, 2 questions past the window");
    expect(
      conversationLine({
        turns: [{ ...turn, live: true }],
        droppedAnswers: null,
        windowDropped: null,
      }),
    ).toBe("after 1 earlier turn, 1 answered live, stopped at a live turn");
    expect(conversationLine({ turns: [turn, turn], droppedAnswers: 2, windowDropped: 1 })).toBe(
      "after 2 earlier turns, 2 answers refused, 1 question past the window",
    );
  });

  it("knows the suite's size the server runs: every case in its cases.ts", () => {
    const cases = readFileSync(resolve(here, "../../../../server/src/ask/evals/cases.ts"), "utf8");
    const suite = cases.slice(cases.indexOf("export const EVAL_CASES"));
    // Each case is an object in the list, its id the first key at its depth (Prettier keeps it there).
    expect(suite.match(/^ {4}id: "/gm)?.length).toBe(EVAL_SUITE_CASES);
  });

  it("says a run's state, a case's result, its time and its judge in words", () => {
    expect(statusWord({ status: "done" })).toBe("finished");
    expect(statusWord({ status: "failed" })).toBe("stopped");
    expect(statusWord({ status: "interrupted" })).toBe("interrupted by a restart");
    const results: EvalCaseResult["status"][] = ["passed", "failed", "unavailable"];
    expect(results.map((status) => resultWord({ status }))).toEqual([
      "Passed",
      "Failed",
      "Unavailable",
    ]);
    expect(seconds(3000)).toBe("3.0 s");
    expect(seconds(940)).toBe("0.9 s");
    expect(judgeScores({ faithfulness: 0.917, helpfulness: 4, unsupported: [] })).toBe("0.92, 4");
    expect(judgeScores(null)).toBe("–");
    expect(
      categoryLine({ fact: { completed: 18, passed: 18 }, german: { completed: 9, passed: 8 } }),
    ).toBe("fact 18 of 18, german 8 of 9");
    expect(
      judgedLine({ promptVersion: "ask-test", judge: "gemini-flash-lite" }, "calibrated"),
    ).toBe("Prompt ask-test, judged by gemini-flash-lite (calibrated).");
    expect(judgedLine({ promptVersion: "ask-test", judge: null }, null)).toBe(
      "Prompt ask-test, judged by no judge.",
    );
  });
});
