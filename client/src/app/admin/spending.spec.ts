import { describe, expect, it } from "vitest";

import type { AssistantSettings, SpendToday } from "./assistant-types";
import { featureRows, spendDraft, spendInput } from "./spending";

const settings: AssistantSettings = {
  enabled: true,
  dailyBudgetUsd: 2,
  deepEnabled: true,
  suggestedQuestions: { en: [], de: [] },
  systemCard: { en: "", de: "" },
  publicReserve: 0.5,
  featureCaps: {
    playground: null,
    copilot: 0.2,
    insights: null,
    eval: null,
    pairwise: null,
    judge: null,
    autoInsights: null,
    agent: null,
    embeddings: null,
  },
  featureSwitches: {
    copilot: false,
    judge: true,
    autoInsights: false,
    agent: false,
    embeddings: false,
  },
  updatedAt: null,
};

describe("the spending fences in the admin", () => {
  it("edits the reserve in percent and sends only the caps and switches the form shows", () => {
    const draft = spendDraft(settings);
    expect(draft.reserve).toBe("50");
    expect(draft.caps).toMatchObject({ copilot: "0.2", eval: "" });
    expect(draft.switches).toEqual({ copilot: false, judge: true, embeddings: false });

    const saved = spendInput({ ...draft, reserve: "40", caps: { ...draft.caps, eval: "0.5" } });
    expect(saved).toEqual({
      ok: true,
      value: {
        publicReserve: 0.4,
        featureCaps: {
          playground: null,
          copilot: 0.2,
          insights: null,
          eval: 0.5,
          pairwise: null,
          judge: null,
          embeddings: null,
        },
        featureSwitches: { copilot: false, judge: true, embeddings: false },
      },
    });
  });

  it("refuses a reserve or a cap out of range", () => {
    const draft = spendDraft(settings);
    expect(spendInput({ ...draft, reserve: "95" }).ok).toBe(false);
    expect(spendInput({ ...draft, reserve: "" }).ok).toBe(false);
    expect(spendInput({ ...draft, caps: { ...draft.caps, copilot: "0" } })).toEqual({
      ok: false,
      error: "The cap for Copilot must be between 0.01 and 100 USD, or empty",
    });
  });

  it("lists every built feature and any other that spent, most spent today first", () => {
    const spend: SpendToday = {
      totalUsd: 0.6,
      budgetUsd: 2,
      publicReserve: 0.5,
      reserveLineUsd: 1,
      features: [
        { feature: "terminal", spentUsd: 0.1, capUsd: null, switchedOn: null, state: "ok" },
        { feature: "eval", spentUsd: 0.5, capUsd: 0.5, switchedOn: null, state: "cap" },
        { feature: "agent", spentUsd: 0, capUsd: null, switchedOn: false, state: "off" },
      ],
    };
    const rows = featureRows(spend, {
      features: [
        { day: "2026-09-30", feature: "copilot", requests: 3, usd: 0.02 },
        { day: "2026-10-01", feature: "eval", requests: 9, usd: 0.5 },
        { day: "2026-09-30", feature: "eval", requests: 4, usd: 0.25 },
      ],
    });
    expect(rows.slice(0, 3)).toEqual([
      {
        feature: "eval",
        label: "Eval runs",
        todayUsd: 0.5,
        periodUsd: 0.75,
        capUsd: 0.5,
        state: "cap",
      },
      {
        feature: "terminal",
        label: "Visitors' terminal",
        todayUsd: 0.1,
        periodUsd: 0,
        capUsd: null,
        state: "ok",
      },
      {
        feature: "copilot",
        label: "Copilot",
        todayUsd: 0,
        periodUsd: 0.02,
        capUsd: null,
        state: null,
      },
    ]);
    // A feature not built yet stays out until it spends.
    expect(rows.map((r) => r.feature)).not.toContain("agent");
    expect(rows).toHaveLength(8);
  });
});
