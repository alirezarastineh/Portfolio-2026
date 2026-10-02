import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/ask-fixtures.js";
import type { Feature } from "./features.js";
import { refusal, stateFor, type Availability } from "./guard.js";
import { DEFAULT_SETTINGS, type AiSettings } from "./settings.js";

/** Budget $2, half kept for visitors: the fenced features stop at $1. */
const settings = (patch: Partial<AiSettings> = {}): AiSettings => ({
  ...DEFAULT_SETTINGS,
  dailyBudgetUsd: 2,
  ...patch,
});

const code = (state: Availability) => (state.state === "ok" ? "ok" : refusal(state));

function check(
  feature: Feature,
  totalUsd: number,
  ownUsd: number,
  patch: Partial<AiSettings> = {},
  config = fixtureConfig(),
) {
  return code(stateFor(config, settings(patch), feature, { totalUsd, ownUsd }));
}

describe("the spending fences (plan phase 13)", () => {
  it("lets the terminal spend the whole budget, and stops the rest at the reserve line", () => {
    expect(check("terminal", 1.5, 0)).toBe("ok");
    expect(check("terminal", 2, 0)).toBe("assistant_resting");
    expect(check("eval", 0.99, 0.99)).toBe("ok");
    expect(check("eval", 1, 0)).toBe("reserve_reached");
    expect(check("copilot", 1, 0)).toBe("reserve_reached");
    expect(check("eval", 2, 0)).toBe("assistant_resting");
  });

  it("stops a feature at its own cap, and leaves the others alone", () => {
    const capped = { featureCaps: { ...DEFAULT_SETTINGS.featureCaps, eval: 0.25 } };
    expect(check("eval", 0.3, 0.2, capped)).toBe("ok");
    expect(check("eval", 0.3, 0.25, capped)).toBe("cap_reached");
    expect(check("pairwise", 0.3, 0.3, capped)).toBe("ok");
  });

  it("with no reserve, the fenced features stop where the terminal does", () => {
    expect(check("eval", 1.99, 0, { publicReserve: 0 })).toBe("ok");
    expect(check("eval", 2, 0, { publicReserve: 0 })).toBe("assistant_resting");
  });

  it("switches a feature off, whatever the spend; the visitors' switch closes only the terminal", () => {
    const off = { featureSwitches: { ...DEFAULT_SETTINGS.featureSwitches, copilot: false } };
    expect(check("copilot", 0, 0, off)).toBe("feature_off");
    expect(check("insights", 0, 0, off)).toBe("ok");
    expect(check("terminal", 0, 0, { enabled: false })).toBe("assistant_off");
    expect(check("playground", 0, 0, { enabled: false })).toBe("ok");
    // Work not built yet, or that would spend on its own, starts switched off.
    expect(check("agent", 0, 0)).toBe("feature_off");
    expect(check("embeddings", 0, 0)).toBe("feature_off");
    expect(check("autoInsights", 0, 0)).toBe("feature_off");
    expect(check("judge", 0, 0)).toBe("ok");
  });

  it("is off for every feature when the deploy switches the assistant off", () => {
    const config = fixtureConfig({ enabled: false });
    for (const feature of ["terminal", "eval", "copilot"] as const) {
      expect(check(feature, 0, 0, {}, config)).toBe("assistant_off");
    }
  });

  it("keeps the deep model to 80 % of the budget for every feature", () => {
    const state = stateFor(fixtureConfig(), settings({ publicReserve: 0 }), "playground", {
      totalUsd: 1.7,
      ownUsd: 0,
    });
    expect(state).toMatchObject({ state: "ok", deepAllowed: false });
  });
});
