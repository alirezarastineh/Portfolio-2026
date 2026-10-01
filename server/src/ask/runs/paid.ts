import type { ModelCall } from "../models/fallback.js";
import { recordUsage, summarizeCalls } from "../usage.js";
import { spendBlocked } from "./budget.js";
import type { RunWork } from "./runner.js";
import type { ItemStatus } from "./store.js";

export const BUDGET_SPENT =
  "Today's budget is spent; resume the run once it resets (midnight UTC).";
export const PROVIDER_DOWN =
  "A model provider stopped answering (quota or outage); resume the run once it is back.";

/**
 * The bookkeeping every paid run shares. The daily budget is checked before
 * each item, and a spent budget stops the run the way a cancel does. Each
 * item's model calls are recorded as usage as soon as it finishes, so the
 * budget sees them. An item cut short by a cancel or the budget is left to do.
 */
export function paidItems(work: RunWork, calls: ModelCall[]) {
  let attributed = 0;
  const budget = new AbortController();
  const signal = AbortSignal.any([work.signal, budget.signal]);
  return {
    /** Aborted by a cancel, a shutdown or the budget. */
    signal,
    budgetSpent: () => budget.signal.aborted,
    /** Before an item: stops at the budget, or marks the item running. */
    async start(key: string): Promise<void> {
      const blocked = await spendBlocked();
      if (blocked) budget.abort(new Error(blocked));
      else await work.startItem(key);
    },
    /** After an item: its spend recorded, and its checkpoint written. */
    async finish(key: string, status: ItemStatus, result?: unknown): Promise<void> {
      const own = calls.slice(attributed);
      attributed = calls.length;
      if (own.length) {
        await recordUsage(own).catch((error) =>
          console.error(`[runs] run ${work.run.id}: usage not recorded`, error),
        );
      }
      const usd = summarizeCalls(own).usd;
      if (signal.aborted) return work.finishItem(key, { status: "pending", usd });
      return work.finishItem(key, { status, result, usd });
    },
  };
}
