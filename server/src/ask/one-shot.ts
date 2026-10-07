import type { AskConfig } from "./config.js";
import { askChain } from "./deps.js";
import type { Feature } from "./features.js";
import { availability, refusal } from "./guard.js";
import { createFallbackModel, newTrace, type Trace } from "./models/fallback.js";
import type { ChainRole, ModelEntry } from "./models/registry.js";
import { readAiSettings } from "./settings.js";
import { countTokens } from "./tokens.js";
import { recordUsage } from "./usage.js";

/**
 * A model call outside the visitor stream (the copilot, insights, insights
 * run by the adaptive trigger): the chain of its role, the same accounting,
 * fenced as its own feature (the visitors' reserve, its cap, its switch).
 */
const ONE_SHOT = {
  copilot: { feature: "copilot", chain: "copilot" },
  insight: { feature: "insights", chain: "insight" },
  /** Insights the adaptive trigger runs (plan phase 25): their own switch and cap. */
  autoInsight: { feature: "autoInsights", chain: "insight" },
} as const satisfies Record<string, { feature: Feature; chain: ChainRole }>;

export type OneShotRole = keyof typeof ONE_SHOT;

/** `accepts` narrows the chain to the models that can take the request (an image, say). */
export async function oneShot<T>(
  config: AskConfig,
  role: OneShotRole,
  run: (model: ReturnType<typeof createFallbackModel>) => Promise<T>,
  accepts: (entry: ModelEntry) => boolean = () => true,
): Promise<{ ok: true; value: T; trace: Trace } | { ok: false; error: string }> {
  const { feature, chain: chainRole } = ONE_SHOT[role];
  const state = await availability(config, await readAiSettings(), feature);
  if (state.state !== "ok") return { ok: false, error: refusal(state) };
  const all = askChain(config, chainRole);
  const chain = all.filter(accepts);
  if (!chain.length)
    return { ok: false, error: all.length ? "no_model_for_this" : "assistant_off" };
  const trace = newTrace();
  const model = createFallbackModel({
    entries: chain,
    trace,
    firstChunkTimeoutMs: config.firstChunkTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    estimateTokens: (options) => countTokens(JSON.stringify(options.prompt)),
  });
  try {
    const value = await run(model);
    return { ok: true, value, trace };
  } catch (error) {
    console.error(`[ask] ${role} call failed`, error);
    return { ok: false, error: "unavailable" };
  } finally {
    if (trace.calls.length) {
      await recordUsage(trace.calls, feature).catch((error) =>
        console.error(`[ask] ${role} usage not recorded`, error),
      );
    }
  }
}
