import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import {
  baselineFrom,
  compareToBaseline,
  parsePercent,
  promptGuard,
  readBaseline,
  recordRefusal,
  type Baseline,
} from "./baseline.js";
import type { EvalSummary } from "./run.js";

const dir = mkdtempSync(join(tmpdir(), "eval-baseline-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function summary(overrides: Partial<EvalSummary> = {}): EvalSummary {
  return {
    promptVersion: "ask-test+000000000001",
    corpus: "eval-fixture-1",
    judge: "gemini-judge",
    cases: 4,
    completed: 4,
    passed: 3,
    unavailable: 0,
    remaining: 0,
    incomplete: false,
    passRate: 0.75,
    byCategory: {
      fact: { cases: 2, completed: 2, passed: 2, unavailable: 0 },
      injection: { cases: 2, completed: 2, passed: 1, unavailable: 0 },
    },
    usd: 0.04,
    p50TtftMs: 1_000,
    p95TotalMs: 10_000,
    results: [],
    ...overrides,
  };
}

const recorded: Baseline = baselineFrom(summary(), { at: new Date("2026-10-01T12:00:00Z") });

describe("readBaseline", () => {
  it("reads a missing file as no run and no waivers", () => {
    const baseline = readBaseline(join(dir, "missing.json"));
    expect(baseline).toMatchObject({ promptVersion: null, passRate: null, waivers: {} });
  });

  it("fills in what an older or partial file lacks", () => {
    const old = file("old.json", {
      promptVersion: "ask-old+abc",
      corpus: "eval-fixture-1",
      passRate: 0.9,
      byCategory: {},
      at: "2026-09-01T00:00:00.000Z",
    });
    expect(readBaseline(old)).toMatchObject({
      promptVersion: "ask-old+abc",
      passRate: 0.9,
      cases: null,
      judge: null,
      usdPerCase: null,
      waivers: {},
    });
  });

  it("refuses a malformed file, and a waiver or an accepted regression without a reason", () => {
    expect(() => readBaseline(file("bad-rate.json", { passRate: "high" }))).toThrow(
      /not a valid eval baseline/,
    );
    expect(() => readBaseline(file("empty-waiver.json", { waivers: { "ask-x+1": " " } }))).toThrow(
      /not a valid eval baseline/,
    );
    const noReason = { acceptedRegression: { reason: "", failures: ["the pass rate fell"] } };
    expect(() => readBaseline(file("empty-acceptance.json", noReason))).toThrow(
      /not a valid eval baseline/,
    );
    expect(() => readBaseline(file("not-json.json", "{"))).toThrow();
  });
});

describe("promptGuard", () => {
  it("passes the version that has a recorded run", () => {
    expect(promptGuard(recorded, "ask-test+000000000001").ok).toBe(true);
  });

  it("passes a waived version and names the reason", () => {
    const waived = { ...recorded, waivers: { "ask-next+000000000002": "Typo in a comment." } };
    expect(promptGuard(waived, "ask-next+000000000002")).toEqual({
      ok: true,
      message: "ask-next+000000000002 is waived: Typo in a comment.",
    });
  });

  it("fails an edited prompt and says how to fix it", () => {
    const verdict = promptGuard(recorded, "ask-test+ffffffffffff");
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("ask-test+000000000001");
    expect(verdict.message).toContain("--update-baseline");
    expect(verdict.message).toContain("waiver");
  });

  it("does not accept a version whose run has no numbers", () => {
    const empty = readBaseline(join(dir, "missing.json"));
    expect(promptGuard({ ...empty, promptVersion: "ask-x+1" }, "ask-x+1").ok).toBe(false);
  });
});

describe("baselineFrom", () => {
  it("records the run, its cost per case and its latency, with no waivers", () => {
    expect(baselineFrom(summary(), { at: new Date("2026-10-02T00:00:00Z") })).toEqual({
      promptVersion: "ask-test+000000000001",
      corpus: "eval-fixture-1",
      cases: 4,
      judge: "gemini-judge",
      passRate: 0.75,
      byCategory: summary().byCategory,
      usdPerCase: 0.01,
      p50TtftMs: 1_000,
      p95TotalMs: 10_000,
      at: "2026-10-02T00:00:00.000Z",
      acceptedRegression: null,
      waivers: {},
    });
  });

  it("keeps the reason a regression was accepted", () => {
    const accepted = {
      reason: "Two harder cases added.",
      failures: ["the pass rate fell 4.0 pts"],
    };
    expect(baselineFrom(summary(), { acceptedRegression: accepted }).acceptedRegression).toEqual(
      accepted,
    );
  });
});

describe("recordRefusal", () => {
  const run = { filtered: false, live: false, failures: [], acceptReason: null };

  it("records a complete, unfiltered fixture run that passes the gate", () => {
    expect(recordRefusal(summary(), run)).toBeNull();
  });

  it("refuses incomplete, filtered, live and unjudged runs", () => {
    expect(recordRefusal(summary({ incomplete: true }), run)).toMatch(/incomplete/);
    expect(recordRefusal(summary(), { ...run, filtered: true })).toMatch(/filtered/);
    expect(recordRefusal(summary(), { ...run, live: true })).toMatch(/live corpus/);
    expect(recordRefusal(summary({ judge: null }), run)).toMatch(/without the judge/);
  });

  it("records a run that fails the gate only with a reason", () => {
    const failing = { ...run, failures: ["the pass rate fell 2.3 pts"] };
    expect(recordRefusal(summary(), failing)).toMatch(/--accept-regression/);
    expect(recordRefusal(summary(), { ...failing, acceptReason: "  " })).toMatch(
      /--accept-regression/,
    );
    expect(recordRefusal(summary(), { ...failing, acceptReason: "Harder cases." })).toBeNull();
  });

  it("replaces a baseline it could not be compared with only with a reason", () => {
    // Another judge, or an edited fixture: nothing says the new run is not worse.
    const incomparable = { ...run, incomparable: "The baseline was judged by a, this run by b." };
    expect(recordRefusal(summary(), incomparable)).toMatch(
      /could not be compared.*--accept-regression/,
    );
    expect(recordRefusal(summary(), { ...incomparable, acceptReason: "New judge." })).toBeNull();
    // The very first run has nothing to be compared with, and needs no reason.
    expect(recordRefusal(summary(), { ...run, incomparable: null })).toBeNull();
  });
});

describe("parsePercent", () => {
  it("reads a percentage as a fraction and refuses anything else", () => {
    expect(parsePercent("25")).toBe(0.25);
    expect(parsePercent("0")).toBe(0);
    for (const bad of ["", " ", "-5", "abc", "Infinity"]) {
      expect(() => parsePercent(bad), bad).toThrow(/percentage/);
    }
  });
});

describe("compareToBaseline", () => {
  it("has nothing to compare before the first recorded run", () => {
    const empty = readBaseline(join(dir, "missing.json"));
    expect(compareToBaseline(summary(), empty)).toMatchObject({ compared: false, failures: [] });
  });

  it("does not compare runs on different corpora", () => {
    const result = compareToBaseline(summary({ corpus: "live-abc" }), recorded);
    expect(result).toMatchObject({ compared: false, failures: [] });
    expect(result.lines[0]).toContain("live-abc");
  });

  it("does not compare an unjudged run with a judged baseline, whose rate it would beat", () => {
    const higher = summary({ judge: null, passed: 4, passRate: 1, usd: 0.4 });
    const result = compareToBaseline(higher, recorded);
    expect(result).toMatchObject({ compared: false, failures: [] });
    expect(result.lines[0]).toBe(
      "The baseline was judged by gemini-judge, this run was not judged: not compared.",
    );
  });

  it("does not compare runs scored by different judges", () => {
    const result = compareToBaseline(summary({ judge: "another-judge", passRate: 0.25 }), recorded);
    expect(result).toMatchObject({ compared: false, failures: [] });
    expect(result.lines[0]).toContain("judged by another-judge");
  });

  it("passes an equal run and fails a lower pass rate", () => {
    expect(compareToBaseline(summary(), recorded)).toMatchObject({ compared: true, failures: [] });
    const worse = compareToBaseline(
      summary({
        passed: 2,
        passRate: 0.5,
        byCategory: {
          fact: { cases: 2, completed: 2, passed: 1, unavailable: 0 },
          injection: { cases: 2, completed: 2, passed: 1, unavailable: 0 },
        },
      }),
      recorded,
    );
    expect(worse.failures).toEqual(["the pass rate fell 25.0 pts"]);
    expect(worse.lines.join("\n")).toMatch(/fact\s+2\/2 → 1\/2 ▼/);
  });

  it("reports a category that moved without failing an unchanged overall rate", () => {
    const swapped = compareToBaseline(
      summary({
        byCategory: {
          fact: { cases: 2, completed: 2, passed: 1, unavailable: 0 },
          injection: { cases: 2, completed: 2, passed: 2, unavailable: 0 },
        },
      }),
      recorded,
    );
    expect(swapped.failures).toEqual([]);
    expect(swapped.lines.join("\n")).toMatch(/fact.*▼/);
    expect(swapped.lines.join("\n")).toMatch(/injection.*▲/);
  });

  it("names categories that were not run or are new", () => {
    const report = compareToBaseline(
      summary({
        byCategory: {
          fact: { cases: 2, completed: 2, passed: 2, unavailable: 0 },
          tool: { cases: 2, completed: 2, passed: 1, unavailable: 0 },
        },
      }),
      recorded,
    ).lines.join("\n");
    expect(report).toMatch(/injection\s+not run \(was 1\/2\)/);
    expect(report).toMatch(/tool\s+1\/2 \(new\)/);
    expect(report).not.toMatch(/fact/);
  });

  it("says so when no category moved", () => {
    expect(compareToBaseline(summary(), recorded).lines).toContain("    every category unchanged");
  });

  it("fails cost per case more than 25 % higher, and honours another limit", () => {
    expect(compareToBaseline(summary({ usd: 0.048 }), recorded).failures).toEqual([]);
    expect(compareToBaseline(summary({ usd: 0.052 }), recorded).failures).toEqual([
      "cost per case rose +30.0 % (limit +25.0 %)",
    ]);
    const generous = { maxCostIncrease: 0.5, maxLatencyIncrease: null };
    expect(compareToBaseline(summary({ usd: 0.052 }), recorded, generous).failures).toEqual([]);
  });

  it("compares cost and latency only over the same number of cases", () => {
    const more = compareToBaseline(summary({ cases: 5, completed: 5, usd: 0.4 }), recorded);
    expect(more.failures).toEqual([]);
    expect(more.lines.join("\n")).toContain("cost, latency  not compared: this run had 5 cases");
  });

  it("reports latency, and gates it only when a limit is set", () => {
    const slow = summary({ p95TotalMs: 20_000 });
    const reported = compareToBaseline(slow, recorded);
    expect(reported.failures).toEqual([]);
    expect(reported.lines.join("\n")).toContain("+100.0 %, not gated");
    const gated = compareToBaseline(slow, recorded, {
      maxCostIncrease: 0.25,
      maxLatencyIncrease: 0.3,
    });
    expect(gated.failures).toEqual(["p95 total time rose +100.0 % (limit +30.0 %)"]);
  });
});

describe("the prompt guard (CI)", () => {
  it("the prompt in prompt.ts has a recorded eval run or an audited waiver", () => {
    const verdict = promptGuard(readBaseline(), `${PROMPT_VERSION}+${PROMPT_HASH}`);
    expect(verdict.ok, verdict.message).toBe(true);
  });
});
