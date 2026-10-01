import { askConfig } from "../deps.js";
import { availability } from "../guard.js";
import { readAiSettings } from "../settings.js";

/**
 * Why a run may not spend now, or null. Whatever the visitors' switch says,
 * the daily budget decides: before a run starts or resumes, and before each
 * of its items, so a run started just under the budget stops at it.
 */
export async function spendBlocked(): Promise<string | null> {
  const state = await availability(askConfig(), { ...(await readAiSettings()), enabled: true });
  return state.state === "ok" ? null : `assistant_${state.state}`;
}
