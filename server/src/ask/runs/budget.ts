import { askConfig } from "../deps.js";
import type { Feature } from "../features.js";
import { availability, refusal } from "../guard.js";
import { readAiSettings } from "../settings.js";
import type { RunKind, RunRow } from "./store.js";

/**
 * The feature a run spends as: its kind's, except the nightly sampled judge
 * (plan phase 26), a run of kind `judge` that spends as `nightlyJudge`, so it
 * has its own switch (off until the admin turns it on) and its own cap, apart
 * from the calibration runs the admin starts by hand.
 */
export function runFeature(run: Pick<RunRow, "kind" | "params">): Feature {
  const kind = run.kind as RunKind;
  const nightly = (run.params as { nightly?: unknown } | null)?.nightly === true;
  return kind === "judge" && nightly ? "nightlyJudge" : kind;
}

/**
 * Why a run spending as `feature` may not spend now, or null: before a run
 * starts or resumes, and before each of its items, so a run started just
 * under a line stops at it. The lines are its feature's (plan phase 13): the
 * share of the day's budget kept for visitors, the feature's own cap, its
 * switch. The visitors' switch does not stop runs. With `projectedUsd` (what
 * the next item will cost), an item that would cross a line is not started.
 */
export async function spendBlocked(feature: Feature, projectedUsd = 0): Promise<string | null> {
  const state = await availability(askConfig(), await readAiSettings(), feature, projectedUsd);
  return state.state === "ok" ? null : refusal(state);
}
