import { describe, expect, it } from "vitest";

import { changeWords, liveChanges, settingsInput, toDraft } from "./assistant-settings";
import type { AssistantSettings } from "./assistant-types";

const SAVED: AssistantSettings = {
  enabled: true,
  dailyBudgetUsd: null,
  deepEnabled: true,
  suggestedQuestions: { en: ["What did he build?"], de: [] },
  systemCard: { en: "", de: "" },
  publicReserve: 0.5,
  featureCaps: {
    match: 0.1,
    playground: null,
    copilot: null,
    insights: null,
    autoInsights: null,
    eval: null,
    pairwise: null,
    judge: null,
    nightlyJudge: null,
    embeddings: null,
    agent: null,
  },
  featureSwitches: {
    match: false,
    copilot: true,
    judge: true,
    nightlyJudge: false,
    embeddings: false,
    autoInsights: false,
    agent: false,
  },
  publicScorecard: false,
  updatedAt: null,
};

describe("Settings' changes in words (plan 5, U19)", () => {
  it("names each change a save puts live, with what it was", () => {
    const saved = toDraft(SAVED);
    const draft = {
      ...saved,
      enabled: false,
      budget: "3",
      publicScorecard: true,
      suggestions: { ...saved.suggestions, en: "What did he build?\nWhere does he work?" },
      systemCard: { ...saved.systemCard, de: "Ein Assistent für das Portfolio." },
      spend: {
        reserve: "60",
        caps: { ...saved.spend.caps, eval: "0.5" },
        switches: { ...saved.spend.switches, copilot: false },
      },
    };
    expect(liveChanges(saved, draft, 2)).toEqual([
      "Answer visitors: off (was on)",
      "Public scorecard: on (was off)",
      "Daily budget: $3.00 (was the deploy's $2.00)",
      "Kept for visitors: 60 % (was 50 %)",
      "Daily cap for Eval runs: $0.50 (was none)",
      "Copilot: off (was on)",
      "Suggested questions in English: changed",
      "How this assistant works in German: changed",
    ]);
  });

  it("puts nothing live for an edit that changes nothing a save sends", () => {
    const saved = toDraft(SAVED);
    const draft = {
      ...saved,
      suggestions: { ...saved.suggestions, en: "What did he build?\n" },
      systemCard: { ...saved.systemCard, en: "   " },
    };
    expect(liveChanges(saved, draft, 2)).toEqual([]);
  });

  it("says the audit log's changes the same way, by the server's keys", () => {
    expect(changeWords("featureSwitches.agent", false, true)).toBe("Admin agents: on (was off)");
    expect(changeWords("dailyBudgetUsd", 2, null)).toBe("Daily budget: the deploy's (was $2.00)");
    expect(changeWords("featureCaps.match", 0.1, null)).toBe(
      "Daily cap for Match a brief: none (was $0.10)",
    );
    expect(changeWords("publicReserve", 0.5, 0.25)).toBe("Kept for visitors: 25 % (was 50 %)");
    expect(changeWords("somethingNew", 1, 2)).toBeNull();
  });

  it("refuses a budget out of range before anything is asked", () => {
    expect(settingsInput({ ...toDraft(SAVED), budget: "0" })).toEqual({
      ok: false,
      error: "The budget must be between 0.01 and 100 USD, or empty",
    });
  });
});
