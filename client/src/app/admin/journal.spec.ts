import { describe, expect, it } from "vitest";

import {
  decisionProblem,
  leadingLine,
  locatedLine,
  NEXT,
  ratioLine,
  refusal,
  replayLines,
  stoppedReplays,
  symptomLabel,
  type Hypothesis,
} from "./journal";
import type { RunRow } from "./assistant-types";

const hypothesis = (over: Partial<Hypothesis>): Hypothesis => ({
  id: "context-unused",
  evidence: [],
  supporting: 0,
  contradicting: 0,
  ratio: 0.5,
  ...over,
});

describe("the failure journal in the admin (plan phase 24)", () => {
  it("says the evidence as a count, and the leading hypothesis in one line", () => {
    expect(ratioLine(hypothesis({}))).toBe("untested");
    expect(ratioLine(hypothesis({ supporting: 2, contradicting: 1, ratio: 2 / 3 }))).toBe(
      "2 for, 1 against · 0.67",
    );
    const leading = hypothesis({ supporting: 2, ratio: 1 });
    expect(leadingLine({ leading: "context-unused", hypotheses: [leading] })).toBe(
      "H3 Context clipped or unused · 2 for, 0 against · 1.00",
    );
    expect(leadingLine({ leading: null, hypotheses: [leading] })).toMatch(/^Undetermined/);
    expect(symptomLabel("unknown")).toBe("didn't know");
    expect(symptomLabel("something-new")).toBe("something-new");
  });

  it("places the fact, with the cut where there is one", () => {
    const base = { id: "project:long@en", named: false, coverage: 1, words: [], pastCut: [] };
    expect(locatedLine({ ...base, position: "rest", held: 2_394, length: 3_512 })).toBe(
      "project:long@en: cut short in the core, a matching word only past the cut, at 2,394 of 3,512 characters",
    );
    expect(locatedLine({ ...base, named: true, position: "whole", held: 90, length: 90 })).toBe(
      "project:long@en (named by you): held whole in the core",
    );
  });

  it("reads each replayed chain's outcome", () => {
    const result = {
      model: "m",
      finishReason: "stop",
      answered: false,
      unknown: false,
      cited: [] as string[],
      flags: [],
      usd: 0,
      unavailable: false,
    };
    expect(
      replayLines([
        { ...result, chain: "lite", unknown: true },
        { ...result, chain: "deep", answered: true, cited: ["project:long@en"] },
        { ...result, chain: "deep", unavailable: true, model: null },
        { ...result, chain: "lite", finishReason: "error:timeout" },
      ]),
    ).toEqual([
      "lite: m said it isn't there",
      "deep: m answered, citing project:long@en",
      "deep: no model answered",
      "lite: m failed (error:timeout)",
    ]);
  });

  it("offers to resume an entry's replay only when its newest one stopped short", () => {
    const run = (id: string, entry: string, status: string, kind = "agent") =>
      ({ id, kind, status, params: { task: "replay", entry } }) as unknown as RunRow;
    // Newest first, as the runs list comes.
    const runs = [
      run("r4", "e1", "failed"),
      run("r3", "e2", "done"),
      run("r2", "e2", "failed"),
      run("r1", "e3", "interrupted"),
      run("r0", "e4", "failed", "eval"),
    ];
    expect(
      Object.fromEntries(Object.entries(stoppedReplays(runs)).map(([k, v]) => [k, v.id])),
    ).toEqual({
      e1: "r4",
      e3: "r1",
    });
  });

  it("holds the server's rules for accepting and fixing", () => {
    const fields = {
      rootCause: "The fact sat past the cut.",
      heuristic: "Keep what visitors ask about in a document's first part.",
      fixType: null,
      fixRef: null,
      caseId: null,
    };
    expect(decisionProblem("proposed", { ...fields, rootCause: "" })).toBeNull();
    expect(decisionProblem("accepted", { ...fields, rootCause: " " })).toBe(
      "Write the root cause first.",
    );
    expect(decisionProblem("accepted", { ...fields, heuristic: "Be careful." })).toMatch(
      /at least 8 words/,
    );
    expect(decisionProblem("accepted", fields)).toBeNull();
    expect(decisionProblem("fixed", fields)).toMatch(/^Name the fix/);
    expect(decisionProblem("fixed", { ...fields, fixType: "content", fixRef: "x" })).toBeNull();
    expect(decisionProblem("fixed", { ...fields, fixType: "prompt", caseId: "c1" })).toBeNull();
    expect(NEXT.proposed).toEqual(["accepted", "retired"]);
    expect(NEXT.retired).toEqual(["proposed"]);
    expect(refusal("feature_off")).toBe("Admin agents are switched off: Settings → Spending.");
    expect(refusal("http_500")).toBe("http_500");
  });
});
