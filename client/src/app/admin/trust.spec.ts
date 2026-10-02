import { describe, expect, it } from "vitest";

import { actionLabel, levelLabel, rulesLine, subjectLabel, trustAlert } from "./trust";

describe("trust in the admin", () => {
  it("names what was demoted, and each level", () => {
    expect(subjectLabel("model:gemini-3.7-flash")).toBe("the model gemini-3.7-flash");
    expect(subjectLabel("route:deep")).toBe("the deep route");
    expect(levelLabel("L0")).toBe("suggests; a person approves each one");
    expect(levelLabel("human")).toBe("people only");
  });

  it("says what waits for a person, or nothing", () => {
    const demotion = (subject: string) => ({ subject, at: "2026-10-01T03:00:00.000Z", reason: "" });
    expect(trustAlert(undefined)).toBeNull();
    expect(trustAlert({ alerts: 0, demoted: [] })).toBeNull();
    expect(trustAlert({ alerts: 2, demoted: [] })).toBe("2 alerts: see the Trust tab");
    expect(trustAlert({ alerts: 0, demoted: [demotion("model:a"), demotion("route:deep")] })).toBe(
      "2 demotions: see the Trust tab",
    );
  });

  it("states the demotion rules", () => {
    expect(
      rulesLine({
        faithfulnessFloor: 0.8,
        judgedWindow: 50,
        judgedMinimum: 20,
        deepErrorCeiling: 0.2,
        deepWindow: 30,
      }),
    ).toBe(
      "A model is demoted when its judged faithfulness falls below 0.8 over its last 50 judged answers (given 20); the deep route when more than 20 % of its last 30 answers failed.",
    );
  });

  it("reads a refused demotion as refused", () => {
    expect(actionLabel({ action: "demote", decision: "allowed" })).toBe("demotion");
    expect(actionLabel({ action: "demote", decision: "denied" })).toBe("demotion refused");
    expect(actionLabel({ action: "run.spend", decision: "denied" })).toBe("run stopped");
    expect(actionLabel({ action: "something.new", decision: "allowed" })).toBe("something.new");
  });
});
