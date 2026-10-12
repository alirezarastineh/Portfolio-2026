import type { AskConfig } from "./config.js";
import { askChain } from "./deps.js";
import type { Feature } from "./features.js";
import { availability, refusal } from "./guard.js";
import { createFallbackModel, newTrace, type ModelCall, type Trace } from "./models/fallback.js";
import type { ChainRole, ModelEntry } from "./models/registry.js";
import { readAiSettings } from "./settings.js";
import { countTokens } from "./tokens.js";
import { recordUsage } from "./usage.js";

/**
 * A model call outside the visitor stream (insights, insights run by the
 * adaptive trigger): the chain of its role, the same accounting, fenced as its
 * own feature (the visitors' reserve, its cap, its switch). The copilot, whose
 * request is several calls on two chains, has `copilotSession` below.
 */
const ONE_SHOT = {
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
  const model = fallbackModel(config, chain, trace);
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

function fallbackModel(config: AskConfig, entries: ModelEntry[], trace: Trace) {
  return createFallbackModel({
    entries,
    trace,
    firstChunkTimeoutMs: config.firstChunkTimeoutMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
    retryMaxDelayMs: config.retryMaxDelayMs,
    estimateTokens: (options) => countTokens(JSON.stringify(options.prompt)),
  });
}

/** The writer and the judge for a skill's job, with their calls (`skillModels`). */
export interface SkillSession {
  ok: true;
  models: {
    writer: ReturnType<typeof createFallbackModel>;
    judge: ReturnType<typeof createFallbackModel> | null;
  };
  /** Every call so far, the writer's and the judge's: the caller records them under its feature. */
  calls(): ModelCall[];
  /** The writer's last answering model. */
  model(): string;
}

/**
 * The models a skill's job runs on (plan phases 28–29): the writer on the
 * copilot chain (only the models `accepts` lets take the request), the judge
 * on the judge chain (none when it is empty: no ranking calls, no critic),
 * each on its own trace. No fence and no usage here: the copilot's request
 * (`copilotSession`) and the content agent's run each check and record their own.
 */
export function skillModels(
  config: AskConfig,
  accepts: (entry: ModelEntry) => boolean,
): SkillSession | { ok: false; error: string } {
  const all = askChain(config, "copilot");
  const writers = all.filter(accepts);
  if (!writers.length)
    return { ok: false, error: all.length ? "no_model_for_this" : "assistant_off" };
  const judges = askChain(config, "judge");
  const writing = newTrace();
  const judging = newTrace();
  return {
    ok: true,
    models: {
      writer: fallbackModel(config, writers, writing),
      judge: judges.length ? fallbackModel(config, judges, judging) : null,
    },
    calls: () => [...writing.calls, ...judging.calls],
    model: () => writing.calls.at(-1)?.model ?? "",
  };
}

/**
 * One copilot request (plan phase 28): drafts, repairs, a judge ranking
 * drafts, a critic reading a translation, so several calls on two chains
 * (`skillModels`). The copilot's fence is checked once; every call is
 * recorded as `copilot`. `model` is the writer's last answering model.
 */
export async function copilotSession<T>(
  config: AskConfig,
  accepts: (entry: ModelEntry) => boolean,
  run: (models: SkillSession["models"]) => Promise<T>,
): Promise<{ ok: true; value: T; model: string } | { ok: false; error: string }> {
  const state = await availability(config, await readAiSettings(), "copilot");
  if (state.state !== "ok") return { ok: false, error: refusal(state) };
  const session = skillModels(config, accepts);
  if (!session.ok) return session;
  try {
    const value = await run(session.models);
    return { ok: true, value, model: session.model() };
  } catch (error) {
    console.error("[ask] copilot call failed", error);
    return { ok: false, error: "unavailable" };
  } finally {
    const calls = session.calls();
    if (calls.length) {
      await recordUsage(calls, "copilot").catch((error) =>
        console.error("[ask] copilot usage not recorded", error),
      );
    }
  }
}
