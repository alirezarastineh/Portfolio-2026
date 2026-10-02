import { askConfig } from "../deps.js";
import type { Feature } from "../features.js";
import { availability, refusal } from "../guard.js";
import { readAiSettings } from "../settings.js";
import type { RunKind } from "./store.js";

// Every run kind spends as the feature of the same name.
const asFeature = (kind: RunKind): Feature => kind;

/**
 * Why a run of `kind` may not spend now, or null: before a run starts or
 * resumes, and before each of its items, so a run started just under a line
 * stops at it. The lines are its kind's (plan phase 13): the share of the day's
 * budget kept for visitors, the kind's own cap, its switch. The visitors'
 * switch does not stop runs.
 */
export async function spendBlocked(kind: RunKind): Promise<string | null> {
  const state = await availability(askConfig(), await readAiSettings(), asFeature(kind));
  return state.state === "ok" ? null : refusal(state);
}
