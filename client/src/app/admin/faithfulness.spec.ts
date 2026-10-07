import { describe, expect, it } from "vitest";

import {
  faithfulLine,
  helpfulLine,
  judgesLine,
  nightlyLine,
  routeLabel,
  type NightlyRun,
} from "./faithfulness";

const run = (change: Partial<NightlyRun> = {}): NightlyRun => ({
  id: "r1",
  at: "2026-10-07T02:30:00.000Z",
  day: "2026-10-06",
  status: "done",
  judged: 5,
  total: 5,
  usd: 0.0003,
  error: null,
  ...change,
});

describe("faithfulness in the admin (plan phase 26)", () => {
  it("says a mean and how many fell below the line, or a dash with nothing judged", () => {
    const stats = { judged: 12, faithfulness: 0.925, helpfulness: 4.25, below: 1 };
    expect(faithfulLine(stats)).toBe("0.93, 1 of 12 below 0.8");
    expect(helpfulLine(stats)).toBe("4.3 of 5");
    const none = { judged: 0, faithfulness: null, helpfulness: null, below: 0 };
    expect(faithfulLine(none)).toBe("–");
    expect(helpfulLine(none)).toBe("–");
    expect(routeLabel("lite→deep")).toBe("Lite, moved up to deep");
    expect(routeLabel("experimental")).toBe("experimental");
  });

  it("names who judged the rows, and the judge now when it differs", () => {
    const one = { model: "gemini-flash-lite", judged: 12 };
    expect(judgesLine({ judge: "gemini-flash-lite", judges: [one] })).toBe(
      "judged by gemini-flash-lite (12)",
    );
    expect(
      judgesLine({
        judge: "gemini-flash-lite",
        judges: [one, { model: "gemini-flash", judged: 2 }],
      }),
    ).toBe(
      "judged by gemini-flash-lite (12) and gemini-flash (2); the judge now: gemini-flash-lite",
    );
    expect(judgesLine({ judge: null, judges: [] })).toBe(
      "nothing judged yet (the judge now: none: no judge may read visitor answers)",
    );
  });

  it("says what the last night did", () => {
    expect(nightlyLine(null)).toMatch(/^The nightly judge has not run yet/);
    expect(nightlyLine(run())).toBe(
      "The last night judged 5 of 5 answers of 2026-10-06 ($0.0003).",
    );
    expect(nightlyLine(run({ status: "running", judged: 2 }))).toBe(
      "Judging 2 of 5 answers of 2026-10-06 now.",
    );
    expect(
      nightlyLine(
        run({ status: "failed", judged: 2, error: "This kind of run reached its own daily cap." }),
      ),
    ).toBe(
      "The last night stopped after 2 of 5 answers of 2026-10-06: This kind of run reached its own daily cap.",
    );
  });
});
