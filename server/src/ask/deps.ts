import type { AskConfig } from "./config.js";
import { getAskConfig } from "./config.js";
import { getAskCorpus, getDraftAskCorpus, type AskCorpus } from "./corpus/index.js";
import { buildChain, type ChainRole, type ModelEntry } from "./models/registry.js";

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
