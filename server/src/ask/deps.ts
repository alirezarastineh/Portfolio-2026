import type { AskConfig } from "./config.js";
import { getAskConfig } from "./config.js";
import { getAskCorpus, getDraftAskCorpus, type AskCorpus } from "./corpus/index.js";
import { FREE_TIER_EVAL_PACING, type EvalPacingOptions } from "./evals/run.js";
import { buildChain, variantChain, type ChainRole, type ModelEntry } from "./models/registry.js";

/**
 * What an answer depends on from outside: settings, models, corpus. Tests
 * swap in mock models and a fixed corpus through `createApp({ ask })`;
 * production uses the defaults.
 */
export interface AskDeps {
  config?: () => AskConfig;
  chain?: (config: AskConfig, role: ChainRole) => ModelEntry[];
  corpus?: (config: AskConfig) => Promise<AskCorpus>;
  draftCorpus?: (config: AskConfig) => Promise<AskCorpus>;
  /** Pacing for background eval runs; null runs them unpaced (tests). */
  evalPacing?: EvalPacingOptions | null;
  /** One model by id, for a pairwise side (`models/registry.ts`). */
  variantChain?: (config: AskConfig, id: string) => ModelEntry[] | null;
}

let current: AskDeps = {};

export function setAskDeps(deps: AskDeps): void {
  current = deps;
}

export function askConfig(): AskConfig {
  return (current.config ?? getAskConfig)();
}

export function askChain(config: AskConfig, role: ChainRole): ModelEntry[] {
  return (current.chain ?? buildChain)(config, role);
}

export function askCorpus(config: AskConfig): Promise<AskCorpus> {
  return (current.corpus ?? getAskCorpus)(config);
}

export function askDraftCorpus(config: AskConfig): Promise<AskCorpus> {
  return (current.draftCorpus ?? getDraftAskCorpus)(config);
}

/** A pairwise side: a route's chain (`lite`, `deep`), or one model by id; null without its key. */
export function askVariantChain(config: AskConfig, variant: string): ModelEntry[] | null {
  if (variant === "lite" || variant === "deep") return askChain(config, variant);
  return (current.variantChain ?? variantChain)(config, variant);
}

/**
 * The judges allowed to read visitor answers: only models that already answer
 * visitors (in the lite or deep chain), so judging adds no new processor of
 * their data. Fixture runs carry no visitor data and may use any judge.
 */
export function askVisitorJudges(config: AskConfig): ModelEntry[] {
  const answering = new Set(
    [...askChain(config, "lite"), ...askChain(config, "deep")].map((e) => e.id),
  );
  return askChain(config, "judge").filter((e) => answering.has(e.id));
}

/** Free-tier-safe pacing unless the deps say otherwise. */
export function askEvalPacing(): EvalPacingOptions | undefined {
  return current.evalPacing === undefined
    ? FREE_TIER_EVAL_PACING
    : (current.evalPacing ?? undefined);
}
