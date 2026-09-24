import { z } from "zod";

/**
 * The assistant's settings, read from the environment (the names already in
 * `.env`: `SERVER_AI_*`, `GEMINI_*`, the OpenRouter keys). Parsed once and
 * validated: an invalid value switches the assistant off with a clear log line
 * rather than taking the whole API down, and so does a missing key.
 */

export type ProviderName = "gemini" | "openrouter";

export interface AskConfig {
  /** `SERVER_AI_ENABLED`; the admin toggle must be on as well. */
  enabled: boolean;
  /** Why the assistant cannot run (no key, invalid setting); null when it can. */
  unavailableReason: string | null;
  providerPriority: ProviderName[];
  gemini: {
    apiKey: string | null;
    model: string;
    deepModel: string | null;
    fallbackModel: string | null;
  };
  openrouter: {
    apiKey: string | null;
    baseURL: string;
    /** `SERVER_AI_MODEL` then `SERVER_AI_FALLBACK_MODELS`, in order. */
    models: string[];
    refererUrl: string;
    appTitle: string;
    /** `deny` asks OpenRouter to route only to hosts that do not keep prompts. */
    dataCollection: "allow" | "deny";
  };
  copilotModel: string;
  copilotHistoryTurns: number;
  insightFallbackModels: string[];
  insightCacheTtlMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  streamTimeoutMs: number;
  firstChunkTimeoutMs: number;
  /** A stream that goes quiet for this long mid-answer is ended. */
  chunkTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  agentMaxRounds: number;
  historyTurns: number;
  dailyBudgetUsd: number;
  ratePerHour: number;
  ratePerDay: number;
  sessionRatePerHour: number;
  maxConcurrent: number;
  explicitCache: boolean;
  /** Longest visitor message, in characters. */
  maxMessageChars: number;
}

const flag = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ["", "1", "0", "true", "false", "yes", "no", "on", "off"].includes(v), {
    message: "expected true/false",
  })
  .transform((v) => ["1", "true", "yes", "on"].includes(v));

const positive = z.string().trim().transform(Number).pipe(z.number().positive());
const nonNegativeInt = z.string().trim().transform(Number).pipe(z.int().nonnegative());
const positiveInt = z.string().trim().transform(Number).pipe(z.int().positive());

const list = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function firstKey(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/** `schema.parse` of an env value, or `fallback` when it is unset or empty. */
function read<T>(name: string, schema: z.ZodType<T>, fallback: T, errors: string[]): T {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  errors.push(`${name}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  return fallback;
}

let cached: AskConfig | undefined;

/** Forgets the parsed config (tests, which change env between cases). */
export function resetAskConfig(): void {
  cached = undefined;
}

export function getAskConfig(): AskConfig {
  cached ??= parseAskConfig();
  return cached;
}

export function parseAskConfig(): AskConfig {
  const errors: string[] = [];
  const seconds = (name: string, fallback: number) =>
    Math.round(read(name, positive, fallback, errors) * 1000);

  const priority = list(process.env.SERVER_AI_PROVIDER_PRIORITY).filter(
    (p): p is ProviderName => p === "gemini" || p === "openrouter",
  );

  const geminiKey = firstKey(
    "SERVER_GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_API_KEY",
  );
  const openrouterKey = firstKey("SERVER_OPENROUTER_API_KEY", "OPENROUTER_API_KEY");
  const openrouterModels = [
    ...list(process.env.SERVER_AI_MODEL),
    ...list(process.env.SERVER_AI_FALLBACK_MODELS),
  ];

  const config: AskConfig = {
    enabled: read("SERVER_AI_ENABLED", flag, false, errors),
    unavailableReason: null,
    providerPriority: priority.length ? [...new Set(priority)] : ["gemini", "openrouter"],
    gemini: {
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
      deepModel: process.env.GEMINI_DEEP_MODEL?.trim() || null,
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL?.trim() || null,
    },
    openrouter: {
      apiKey: openrouterKey,
      baseURL: process.env.SERVER_OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      models: [...new Set(openrouterModels)],
      refererUrl: process.env.SERVER_AI_REFERER_URL?.trim() || "",
      appTitle: process.env.SERVER_AI_APP_TITLE?.trim() || "",
      dataCollection: read(
        "SERVER_AI_OPENROUTER_DATA_COLLECTION",
        z.enum(["allow", "deny"]),
        "allow",
        errors,
      ),
    },
    copilotModel:
      process.env.SERVER_AI_COPILOT_MODEL?.trim() ||
      process.env.GEMINI_DEEP_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      "gemini-3.5-flash-lite",
    copilotHistoryTurns: read("SERVER_AI_COPILOT_HISTORY_TURNS", positiveInt, 8, errors),
    insightFallbackModels: list(process.env.SERVER_AI_INSIGHT_FALLBACK_MODELS),
    insightCacheTtlMs: seconds("SERVER_AI_INSIGHT_CACHE_TTL_SECONDS", 3600),
    maxInputTokens: read("SERVER_AI_MAX_INPUT_TOKENS", positiveInt, 120_000, errors),
    maxOutputTokens: read("SERVER_AI_MAX_OUTPUT_TOKENS", positiveInt, 1024, errors),
    requestTimeoutMs: seconds("SERVER_AI_REQUEST_TIMEOUT_SECONDS", 60),
    streamTimeoutMs: seconds("SERVER_AI_STREAM_TIMEOUT_SECONDS", 120),
    firstChunkTimeoutMs: seconds("SERVER_AI_FIRST_CHUNK_TIMEOUT_SECONDS", 6),
    chunkTimeoutMs: seconds("SERVER_AI_CHUNK_TIMEOUT_SECONDS", 15),
    maxRetries: read("SERVER_AI_MAX_RETRIES", nonNegativeInt, 1, errors),
    retryBaseDelayMs: seconds("SERVER_AI_RETRY_BASE_DELAY_SECONDS", 0.5),
    retryMaxDelayMs: seconds("SERVER_AI_RETRY_MAX_DELAY_SECONDS", 8),
    agentMaxRounds: read("SERVER_AI_AGENT_MAX_ROUNDS", positiveInt, 5, errors),
    historyTurns: read("SERVER_AI_HISTORY_TURNS", positiveInt, 8, errors),
    dailyBudgetUsd: read("SERVER_AI_DAILY_BUDGET_USD", positive, 2, errors),
    ratePerHour: read("SERVER_AI_RATE_PER_HOUR", positiveInt, 20, errors),
    ratePerDay: read("SERVER_AI_RATE_PER_DAY", positiveInt, 60, errors),
    sessionRatePerHour: read("SERVER_AI_SESSION_RATE_PER_HOUR", positiveInt, 30, errors),
    maxConcurrent: read("SERVER_AI_MAX_CONCURRENT", positiveInt, 8, errors),
    explicitCache: read("SERVER_AI_EXPLICIT_CACHE", flag, false, errors),
    maxMessageChars: 600,
  };

  if (config.retryMaxDelayMs < config.retryBaseDelayMs) {
    errors.push("SERVER_AI_RETRY_MAX_DELAY_SECONDS is below the base delay");
  }
  if (config.firstChunkTimeoutMs >= config.requestTimeoutMs) {
    errors.push("SERVER_AI_FIRST_CHUNK_TIMEOUT_SECONDS must be below the request timeout");
  }

  if (errors.length) {
    config.unavailableReason = `invalid settings: ${errors.join("; ")}`;
  } else if (!geminiKey && !(openrouterKey && config.openrouter.models.length)) {
    config.unavailableReason = "no model provider key is set";
  }
  return config;
}
