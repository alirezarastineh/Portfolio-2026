import { audit } from "../audit.js";
import type { ModelCall } from "../models/fallback.js";
import { recordUsage, summarizeCalls } from "../usage.js";
import { runFeature, spendBlocked } from "./budget.js";
import type { RunWork } from "./runner.js";
import { dearestItemUsd, type ItemStatus } from "./store.js";

export const BUDGET_SPENT =
  "Today's budget is spent; resume the run once it resets (midnight UTC).";
export const PROVIDER_DOWN =
  "A model provider stopped answering (quota or outage); resume the run once it is back.";

/** Why a run stopped short of its items, by the refusal that stopped it (guard.ts). */
const STOPPED: Partial<Record<string, string>> = {
  assistant_resting: BUDGET_SPENT,
  reserve_reached:
    "Today's spend reached the share of the budget kept for visitors; resume the run once it resets (midnight UTC), or lower the reserve in Settings.",
  cap_reached:
    "This kind of run reached its own daily cap; resume it once the cap resets (midnight UTC), or raise the cap in Settings.",
  feature_off: "This kind of run is switched off in Settings; switch it on to resume.",
  assistant_off: "The assistant is off in this deploy; resume the run once it is on.",
};

/** The message a run stopped by `refusal` ends with; an unknown one reads as the budget. */
export function stopMessage(refusal: string): string {
  return STOPPED[refusal] ?? BUDGET_SPENT;
}

/**
 * The bookkeeping every paid run shares. The run's spending lines are checked
 * before each item, and a line reached stops the run the way a cancel does.
 * Each item's model calls are recorded as usage, under the run's feature (its
 * kind's, or `nightlyJudge`: budget.ts), as soon as it finishes, so the lines
 * see them. An item cut short by a cancel or a line is left to do. With
 * `projected` (the nightly judge, plan phase 26), the next item is assumed to
 * cost as much as the dearest so far (of this run and the last runs like it),
 * and one that would cross a line is not started: the run stops before its
 * lines rather than just past them, unless an item costs more than any before.
 */
export function paidItems(
  work: RunWork,
  calls: ModelCall[],
  options: { projected?: boolean } = {},
) {
  const feature = runFeature(work.run);
  let attributed = 0;
  /** The dearest item so far, of this run and the last runs like it (store.ts). */
  let dearest: number | null = options.projected ? null : 0;
  const budget = new AbortController();
  const signal = AbortSignal.any([work.signal, budget.signal]);
  return {
    /** Aborted by a cancel, a shutdown or a spending line. */
    signal,
    /** Why a spending line stopped the run, or null when none did. */
    stoppedBy: (): string | null =>
      budget.signal.aborted ? stopMessage((budget.signal.reason as Error).message) : null,
    /** Before an item: stops at a spending line (audited), or marks the item running. */
    async start(key: string): Promise<void> {
      dearest ??= await dearestItemUsd(work.run);
      const blocked = await spendBlocked(feature, options.projected ? dearest : 0);
      if (!blocked) return work.startItem(key);
      budget.abort(new Error(blocked));
      await audit({
        actor: "agent",
        action: "run.spend",
        target: work.run.id,
        decision: "denied",
        reason: `${feature} run stopped before ${key}: ${blocked}`,
      }).catch((error) => console.error(`[runs] run ${work.run.id}: stop not audited`, error));
    },
    /** After an item: its spend recorded, and its checkpoint written. */
    async finish(key: string, status: ItemStatus, result?: unknown): Promise<void> {
      const own = calls.slice(attributed);
      attributed = calls.length;
      if (own.length) {
        await recordUsage(own, feature).catch((error) =>
          console.error(`[runs] run ${work.run.id}: usage not recorded`, error),
        );
      }
      const usd = summarizeCalls(own).usd;
      dearest = Math.max(dearest ?? 0, usd);
      if (signal.aborted) return work.finishItem(key, { status: "pending", usd });
      return work.finishItem(key, { status, result, usd });
    },
  };
}
