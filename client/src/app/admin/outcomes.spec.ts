import { describe, expect, it } from "vitest";

import {
  browserTiles,
  downReasonLine,
  funnelLine,
  matchLine,
  matchRowsLine,
  seconds,
  share,
  tourLine,
  usd,
  type BrowserView,
} from "./outcomes";

describe("outcomes in the admin", () => {
  it("shows shares and costs, or a dash when there is nothing to divide", () => {
    expect(share(0.456)).toBe("46 %");
    expect(share(null)).toBe("–");
    expect(usd(0.00276)).toBe("$0.0028");
    expect(usd(null)).toBe("–");
  });

  it("counts the guided tours and the share taken to the last stop (visitor plan V16)", () => {
    expect(tourLine({ started: 3, finished: 1, finishedRate: 1 / 3 })).toBe(
      "3 tours planned, 1 taken to the last stop (33 %)",
    );
    expect(tourLine({ started: 1, finished: 0, finishedRate: 0 })).toBe(
      "1 tour planned, 0 taken to the last stop (0 %)",
    );
    expect(tourLine({ started: 0, finished: 0, finishedRate: null })).toBe("No tour planned yet");
  });

  it("reads each kind of match to its hand-off, and the rows the critic took back (visitor plan V20)", () => {
    const none = { runs: 0, handoffs: 0, handoffRate: null };
    const m = {
      runs: 5,
      byKind: {
        role: { runs: 4, handoffs: 1, handoffRate: 0.25 },
        project: { runs: 1, handoffs: 0, handoffRate: 0 },
        problem: none,
      },
      rows: 12,
      downgraded: 2,
      downgradedRate: 2 / 12,
      gaps: 3,
    };
    expect(matchLine(m)).toBe(
      "roles 4 → 1 hand-off (25 %), projects 1 → 0 hand-offs (0 %), problems none",
    );
    expect(matchRowsLine(m)).toBe(
      "12 rows, 2 taken back by the critic (17 %); 3 items nothing published covers",
    );
    expect(matchLine({ ...m, runs: 0 })).toBe("No brief matched yet");
  });

  it("reads the hand-off funnel with the share that made each step", () => {
    expect(funnelLine({ offered: 4, confirmed: 2, sent: 1 })).toBe(
      "4 offered → 2 confirmed (50 %) → 1 sent (50 %)",
    );
    expect(funnelLine({ offered: 0, confirmed: 0, sent: 0 })).toBe(
      "0 offered → 0 confirmed → 0 sent",
    );
  });

  it("shows what the browsers saw beside the server, and the thumbs-downs by reason (visitor plan V2)", () => {
    const view: BrowserView = {
      reported: 3,
      shownP50Ms: 900,
      shownP95Ms: 4_050,
      serverP50Ms: 700,
      serverP95Ms: null,
      stopRate: 1 / 3,
      copyRate: 0,
      followupRate: 0.5,
      citationRate: null,
      retried: 1,
      downReasons: { wrong: 2, unanswered: 0, length: 1, none: 1 },
    };
    expect(seconds(4_050)).toBe("4.0 s");
    expect(seconds(null)).toBe("–");
    expect(browserTiles(view)).toEqual([
      {
        label: "First word, as visitors saw it (p50 / p95)",
        value: "0.9 s / 4.0 s",
        detail: "the server's first token: 0.7 s / –",
      },
      { label: "Stopped mid-answer", value: "33 %" },
      { label: "Follow-ups clicked", value: "50 %", detail: "of answers offering them" },
      { label: "Citations followed", value: "–", detail: "of answers citing" },
      { label: "Copied", value: "0 %" },
      { label: "Asked again after a failure", value: "1" },
    ]);
    expect(downReasonLine(view)).toBe(
      "👎 by reason: 2 wrong or made up, 1 too long or too short, 1 no reason given",
    );
    expect(
      downReasonLine({ ...view, downReasons: { wrong: 0, unanswered: 0, length: 0, none: 0 } }),
    ).toBeNull();
  });
});
