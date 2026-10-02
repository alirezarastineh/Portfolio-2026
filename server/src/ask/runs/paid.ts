import { audit } from "../audit.js";
import type { ModelCall } from "../models/fallback.js";
import { recordUsage, summarizeCalls } from "../usage.js";
import { spendBlocked } from "./budget.js";
import type { RunWork } from "./runner.js";
import type { ItemStatus, RunKind } from "./store.js";

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
 * Each item's model calls are recorded as usage, under the run's kind, as soon
 * as it finishes, so the lines see them. An item cut short by a cancel or a
 * line is left to do.
 */
export function paidItems(work: RunWork, calls: ModelCall[]) {
  const kind = work.run.kind as RunKind;
  let attributed = 0;
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
      const blocked = await spendBlocked(kind);
      if (!blocked) return work.startItem(key);
      budget.abort(new Error(blocked));
      await audit({
        actor: "agent",
        action: "run.spend",
        target: work.run.id,
        decision: "denied",
        reason: `${kind} run stopped before ${key}: ${blocked}`,
      }).catch((error) => console.error(`[runs] run ${work.run.id}: stop not audited`, error));
    },
    /** After an item: its spend recorded, and its checkpoint written. */
    async finish(key: string, status: ItemStatus, result?: unknown): Promise<void> {
      const own = calls.slice(attributed);
      attributed = calls.length;
      if (own.length) {
        await recordUsage(own, kind).catch((error) =>
          console.error(`[runs] run ${work.run.id}: usage not recorded`, error),
        );
      }
      const usd = summarizeCalls(own).usd;
      if (signal.aborted) return work.finishItem(key, { status: "pending", usd });
      return work.finishItem(key, { status, result, usd });
    },
  };
}
