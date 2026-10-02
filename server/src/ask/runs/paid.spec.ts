import { describe, expect, it } from "vitest";

import { refusal, type Availability } from "../guard.js";
import { BUDGET_SPENT, stopMessage } from "./paid.js";

describe("a run stopped by a spending line", () => {
  it("says which line it reached, and what lets it resume", () => {
    expect(stopMessage("assistant_resting")).toBe(BUDGET_SPENT);
    expect(stopMessage("reserve_reached")).toMatch(/kept for visitors/);
    expect(stopMessage("cap_reached")).toMatch(/its own daily cap/);
    expect(stopMessage("feature_off")).toMatch(/switched off in Settings/);
    expect(stopMessage("assistant_off")).toMatch(/off in this deploy/);
    // A refusal added later without its own message reads as the budget.
    expect(stopMessage("something_new")).toBe(BUDGET_SPENT);
  });

  it("has its own message for every refusal the fences give", () => {
    const states: Exclude<Availability, { state: "ok" }>[] = [
      { state: "off", reason: "disabled" },
      { state: "off", reason: "switched_off" },
      { state: "resting", spentUsd: 2, budgetUsd: 2, line: "reserve" },
      { state: "resting", spentUsd: 2, budgetUsd: 2, line: "cap" },
    ];
    const messages = states.map((s) => stopMessage(refusal(s)));
    expect(new Set([...messages, BUDGET_SPENT]).size).toBe(states.length + 1);
  });
});
