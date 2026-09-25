import type { Locale } from "../content/schema";

/** Shapes of the admin assistant API (`server/src/ask/admin.ts`). */

export interface AssistantSettings {
  enabled: boolean;
  /** Null = the deploy's `SERVER_AI_DAILY_BUDGET_USD`. */
  dailyBudgetUsd: number | null;
  deepEnabled: boolean;
  suggestedQuestions: Record<Locale, string[]>;
  systemCard: Record<Locale, string>;
  updatedAt: string | null;
}

export type AssistantSettingsInput = Omit<AssistantSettings, "updatedAt">;

export interface ChainModel {
  id: string;
  provider: "gemini" | "openrouter";
  tools: boolean;
  contextWindow: number;
  available: boolean;
}

export interface AssistantEnv {
  enabled: boolean;
  unavailableReason: string | null;
  defaultBudgetUsd: number;
  keys: { gemini: boolean; openrouter: boolean };
  chains: Record<"lite" | "deep" | "copilot" | "insight", ChainModel[]>;
  limits: {
    ratePerHour: number;
    ratePerDay: number;
    maxConcurrent: number;
    maxOutputTokens: number;
    historyTurns: number;
  };
  prompt: string;
}

export type AssistantState =
  | { state: "ok"; deepAllowed: boolean; spentUsd: number; budgetUsd: number }
  | { state: "off"; reason: string }
  | { state: "resting"; spentUsd: number; budgetUsd: number };

export interface BreakerRow {
  model: string;
  state: "closed" | "open" | "half-open";
  openUntil: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  p50TtftMs: number | null;
}

export interface AssistantHealth {
  state: AssistantState;
  inFlight: number;
  breakers: BreakerRow[];
  last24h: {
    answers: number;
    failures: number;
    fallbackRate: number;
    models: {
      model: string;
      answers: number;
      p50TtftMs: number | null;
      p95TtftMs: number | null;
    }[];
  };
  corpus: {
    key: string;
    documents: Record<string, number>;
    coreChars: number;
    coreTokens: number;
  } | null;
}

export interface UsageRow {
  day: string;
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  usd: number;
}

export interface AnswersRow {
  day: string;
  answers: number;
  up: number;
  down: number;
}

export interface Attempt {
  model: string;
  outcome: string;
  ms: number;
  error?: string;
}

export interface ConversationRow {
  id: string;
  createdAt: string;
  session: string;
  locale: Locale;
  route: string;
  question: string;
  answer: string;
  citedIds: string[];
  toolCalls: string[];
  model: string | null;
  attempts: Attempt[];
  ttftMs: number | null;
  totalMs: number;
  tokens: { input: number; cached: number; output: number; thoughts: number };
  usd: number;
  finishReason: string;
  promptVersion: string;
  feedback: 1 | -1 | null;
}

export type ConversationFilter = "all" | "down" | "unknown" | "failed";

export interface FaqEntry {
  id: string;
  position: number;
  isVisible: boolean;
  translations: Partial<Record<Locale, { question: string; answer: string }>>;
  updatedAt: string;
}

export interface FaqInput {
  isVisible: boolean;
  translations: Partial<Record<Locale, { question: string; answer: string }>>;
}

export interface InsightTopic {
  title: string;
  summary: string;
  questions: number;
  examples: string[];
  unanswered: boolean;
}

export interface EvalCaseResult {
  id: string;
  category: string;
  status: "passed" | "failed" | "unavailable";
  passed: boolean;
  failures: string[];
  answer: string;
  cited: string[];
  invented: string[];
  tools: { name: string; input: unknown }[];
  model: string | null;
  ttftMs: number | null;
  totalMs: number;
  usd: number;
  judge: { faithfulness: number; helpfulness: number; unsupported: string[] } | null;
  attempts: Attempt[];
}

export interface EvalSummary {
  promptVersion: string;
  corpus: string;
  cases: number;
  completed: number;
  passed: number;
  unavailable: number;
  remaining: number;
  incomplete: boolean;
  passRate: number;
  byCategory: Record<
    string,
    { cases: number; completed: number; passed: number; unavailable: number }
  >;
  usd: number;
  p50TtftMs: number | null;
  p95TotalMs: number | null;
  results: EvalCaseResult[];
}

export type CopilotInput =
  | { task: "translate"; text: string; from: Locale; to: Locale; html?: boolean }
  | { task: "tighten"; text: string; locale: Locale; maxLength?: number }
  | { task: "seo"; text: string; locale: Locale; maxLength?: number }
  | { task: "faq-answer"; question: string; locale: Locale };
