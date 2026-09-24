import { createGoogle } from "@ai-sdk/google";
import type { LanguageModelV4, SharedV4ProviderOptions } from "@ai-sdk/provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import type { AskConfig, ProviderName } from "../config.js";

/**
 * Every model the assistant may call, with what it can do. The chains below
 * are built from the settings in `.env`; the fallback wrapper walks a chain in
 * order, skipping models that cannot serve a request (tools needed, prompt too
 * long) or whose breaker is open.
 */

export interface ModelCaps {
  contextWindow: number;
  tools: boolean;
  structuredOutputs: boolean;
  caching: boolean;
}

export interface ModelEntry extends ModelCaps {
  id: string;
  provider: ProviderName;
  model: LanguageModelV4;
  /** Merged over the request's provider options for this model only. */
  providerOptions?: SharedV4ProviderOptions;
  /** False once the boot check found the model missing. */
  available: boolean;
}

/** Read from each provider's model list on 2026-09-22; the boot check refreshes them. */
const KNOWN_CAPS: Record<string, ModelCaps> = {
  "gemini-3.5-flash-lite": {
    contextWindow: 1_048_576,
    tools: true,
    structuredOutputs: true,
    caching: true,
  },
  "gemini-3.7-flash": {
    contextWindow: 1_048_576,
    tools: true,
    structuredOutputs: true,
    caching: true,
  },
  "gemma-4-31b-it": {
    contextWindow: 262_144,
    tools: true,
    structuredOutputs: false,
    caching: false,
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    contextWindow: 262_144,
    tools: true,
    structuredOutputs: true,
    caching: false,
  },
  "nvidia/nemotron-3-ultra-550b-a55b:free": {
    contextWindow: 1_048_576,
    tools: true,
    structuredOutputs: false,
    caching: false,
  },
  "z-ai/glm-5.2:free": {
    contextWindow: 32_768,
    tools: false,
    structuredOutputs: false,
    caching: false,
  },
};

/** An unknown model is assumed to be small and tool-less until the boot check says otherwise. */
function defaultCaps(provider: ProviderName): ModelCaps {
  return provider === "gemini"
    ? { contextWindow: 1_048_576, tools: true, structuredOutputs: true, caching: true }
    : { contextWindow: 32_768, tools: false, structuredOutputs: false, caching: false };
}

const learned = new Map<string, Partial<ModelCaps> & { missing?: boolean }>();

export function providerOf(id: string): ProviderName {
  // OpenRouter ids are `vendor/model`; Gemini API ids never contain a slash.
  return id.includes("/") ? "openrouter" : "gemini";
}

export function capsOf(id: string): ModelCaps & { missing: boolean } {
  const base = KNOWN_CAPS[id] ?? defaultCaps(providerOf(id));
  const extra = learned.get(id) ?? {};
  return { ...base, ...extra, missing: extra.missing ?? false };
}

/** Shown in the terminal's meta line and the admin: `gemini-3.5-flash-lite`, `nemotron-3-super`. */
export function shortName(id: string): string {
  const name = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return name.replace(/:free$/, "").replace(/-\d+b(-a\d+b)?$/, "");
}

const SAFETY_CATEGORIES = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
] as const;

type Thinking = "minimal" | "low" | "medium" | "high";

function googleOptions(id: string, thinking: Thinking | null): SharedV4ProviderOptions {
  return {
    google: {
      safetySettings: SAFETY_CATEGORIES.map((category) => ({
        category,
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      })),
      // Gemma takes no thinking settings; thoughts are never sent to visitors.
      ...(thinking && id.startsWith("gemini-")
        ? { thinkingConfig: { thinkingLevel: thinking, includeThoughts: false } }
        : {}),
    },
  };
}

interface Providers {
  google: ReturnType<typeof createGoogle> | null;
  openrouter: ReturnType<typeof createOpenRouter> | null;
}

const providerCache = new WeakMap<AskConfig, Providers>();
const modelCache = new Map<string, LanguageModelV4>();

function providers(config: AskConfig): Providers {
  let cached = providerCache.get(config);
  if (!cached) {
    cached = {
      google: config.gemini.apiKey ? createGoogle({ apiKey: config.gemini.apiKey }) : null,
      openrouter: config.openrouter.apiKey
        ? createOpenRouter({
            apiKey: config.openrouter.apiKey,
            baseURL: config.openrouter.baseURL,
            compatibility: "strict",
            ...(config.openrouter.refererUrl ? { appUrl: config.openrouter.refererUrl } : {}),
            ...(config.openrouter.appTitle ? { appName: config.openrouter.appTitle } : {}),
            ...(config.openrouter.dataCollection === "deny"
              ? { extraBody: { provider: { data_collection: "deny" } } }
              : {}),
          })
        : null,
    };
    providerCache.set(config, cached);
    modelCache.clear();
  }
  return cached;
}

function entry(config: AskConfig, id: string, thinking: Thinking | null): ModelEntry | null {
  const provider = providerOf(id);
  const { google, openrouter } = providers(config);
  const key = `${provider}:${id}`;
  let model = modelCache.get(key);
  if (!model) {
    if (provider === "gemini" && google) model = google(id);
    else if (provider === "openrouter" && openrouter) model = openrouter.chat(id);
    if (!model) return null;
    modelCache.set(key, model);
  }
  const caps = capsOf(id);
  return {
    id,
    provider,
    model,
    contextWindow: caps.contextWindow,
    tools: caps.tools,
    structuredOutputs: caps.structuredOutputs,
    caching: caps.caching,
    available: !caps.missing,
    ...(provider === "gemini" ? { providerOptions: googleOptions(id, thinking) } : {}),
  };
}

function collectCopilotModels(
  config: AskConfig,
  gemini: [string, Thinking | null][],
  openrouter: string[],
): void {
  const first = config.copilotModel;
  if (providerOf(first) === "gemini") {
    gemini.push([first, "low"]);
  } else {
    openrouter.unshift(first);
  }
  const { model, deepModel } = config.gemini;
  if (deepModel && deepModel !== first) gemini.push([deepModel, "low"]);
  if (model !== first) gemini.push([model, "low"]);
}

function collectRoleModels(
  config: AskConfig,
  role: ChainRole,
): { gemini: [string, Thinking | null][]; openrouter: string[] } {
  const { model, deepModel, fallbackModel } = config.gemini;
  const gemini: [string, Thinking | null][] = [];
  const openrouter: string[] = [...config.openrouter.models];

  switch (role) {
    case "lite":
      gemini.push([model, "low"]);
      if (deepModel) gemini.push([deepModel, "low"]);
      if (fallbackModel) gemini.push([fallbackModel, null]);
      break;
    case "deep":
      if (deepModel) gemini.push([deepModel, "medium"]);
      gemini.push([model, "low"]);
      if (fallbackModel) gemini.push([fallbackModel, null]);
      break;
    case "insight":
      gemini.push([model, "low"]);
      openrouter.splice(0, openrouter.length, ...config.insightFallbackModels);
      break;
    case "copilot":
      collectCopilotModels(config, gemini, openrouter);
      break;
    case "judge":
      gemini.push([deepModel ?? model, "low"]);
      openrouter.length = 0;
      break;
  }

  return { gemini, openrouter };
}

export type ChainRole = "lite" | "deep" | "insight" | "copilot" | "judge";

/**
 * The models for one kind of request, first choice first, each at most once.
 * Provider order follows `SERVER_AI_PROVIDER_PRIORITY`.
 */
export function buildChain(config: AskConfig, role: ChainRole): ModelEntry[] {
  const { gemini, openrouter } = collectRoleModels(config, role);

  const byProvider: Record<ProviderName, ModelEntry[]> = {
    gemini: gemini.map(([id, thinking]) => entry(config, id, thinking)).filter((e) => e !== null),
    openrouter: openrouter.map((id) => entry(config, id, null)).filter((e) => e !== null),
  };

  const seen = new Set<string>();
  const chain: ModelEntry[] = [];
  for (const provider of config.providerPriority) {
    for (const e of byProvider[provider]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      chain.push(e);
    }
  }
  return chain;
}

/** Every configured model id, for the admin's health view. */
export function configuredModels(config: AskConfig): string[] {
  const ids = new Set<string>();
  for (const role of ["lite", "deep", "insight", "copilot"] as const) {
    for (const e of buildChain(config, role)) ids.add(e.id);
  }
  return [...ids];
}

/**
 * Asks each provider whether the configured models exist and what they can
 * do. A missing or renamed model is logged and skipped from then on, never a
 * crash; a failed check (network) changes nothing.
 */
export async function checkModels(
  config: AskConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const ids = configuredModels(config);
  const signal = AbortSignal.timeout(10_000);

  const geminiIds = ids.filter((id) => providerOf(id) === "gemini");
  if (config.gemini.apiKey) {
    await Promise.all(
      geminiIds.map(async (id) => {
        try {
          const res = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}`,
            { headers: { "x-goog-api-key": config.gemini.apiKey! }, signal },
          );
          if (res.status === 404) {
            learned.set(id, { missing: true });
            console.error(`[ask] model ${id} does not exist on the Gemini API; skipping it`);
            return;
          }
          if (!res.ok) return;
          const info = (await res.json()) as { inputTokenLimit?: number };
          if (info.inputTokenLimit) learned.set(id, { contextWindow: info.inputTokenLimit });
        } catch (error) {
          console.warn(`[ask] could not check ${id}`, (error as Error).message);
        }
      }),
    );
  }

  const openrouterIds = ids.filter((id) => providerOf(id) === "openrouter");
  if (config.openrouter.apiKey && openrouterIds.length) {
    try {
      const res = await fetchImpl(`${config.openrouter.baseURL.replace(/\/$/, "")}/models`, {
        headers: { authorization: `Bearer ${config.openrouter.apiKey}` },
        signal,
      });
      if (!res.ok) return;
      const list = (await res.json()) as {
        data?: { id: string; context_length?: number; supported_parameters?: string[] }[];
      };
      const byId = new Map((list.data ?? []).map((m) => [m.id, m]));
      for (const id of openrouterIds) {
        const info = byId.get(id);
        if (!info) {
          learned.set(id, { missing: true });
          console.error(`[ask] model ${id} is not listed by OpenRouter; skipping it`);
          continue;
        }
        const params = info.supported_parameters ?? [];
        learned.set(id, {
          ...(info.context_length ? { contextWindow: info.context_length } : {}),
          tools: params.includes("tools"),
          structuredOutputs: params.includes("structured_outputs"),
        });
      }
    } catch (error) {
      console.warn("[ask] could not check the OpenRouter models", (error as Error).message);
    }
  }
}

/** Tests only. */
export function resetLearnedCaps(): void {
  learned.clear();
}
