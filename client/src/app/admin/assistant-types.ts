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
  /** Answers with at least one invented citation (removed before the visitor saw it). */
  withDropped: number;
  /** Answers any deterministic check flagged. */
  flagged: number;
  /** Input and cached tokens of the answers the primary model gave. */
  primaryInput: number;
  primaryCached: number;
}

/** Requests the public assistant turned away, per UTC day and kind. */
export interface GuardEventRow {
  day: string;
  kind: string;
  count: number;
}

export interface AssistantUsage {
  days: number;
  /** The lite chain's first model: the one whose cache hits matter. */
  primaryModel: string | null;
  models: UsageRow[];
  answers: AnswersRow[];
  guardEvents: GuardEventRow[];
  /** How often each check flag was raised over the period, most frequent first. */
  checks: { flag: string; count: number }[];
}

export interface Attempt {
  model: string;
  outcome: string;
  ms: number;
  error?: string;
}

export type ToolOutcome = "ok" | "not_found" | "not_allowed" | "no_hits" | "error" | "cut-off";

export interface TraceTool {
  name: string;
  /** The call's input as JSON, redacted and cut to 300 characters. */
  input: string;
  outcome: ToolOutcome;
  resultChars: number;
}

export interface TraceStep {
  /** The model that answered this step; null when none could. */
  model: string | null;
  answerOnly: boolean;
  ttftMs: number | null;
  tokens: { input: number; cached: number; output: number; thoughts: number } | null;
  finishReason: string | null;
  /** Models tried first and passed over, with why. */
  passedOver: { model: string; outcome: string; ms: number }[];
  tools: TraceTool[];
}

/** What one answer did, step by step (`server/src/ask/trace.ts`). */
export interface AnswerTrace {
  v: 1;
  steps: TraceStep[];
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
  /** Citation ids the model invented; removed before the visitor saw them. */
  droppedCitations: string[];
  toolCalls: string[];
  model: string | null;
  attempts: Attempt[];
  ttftMs: number | null;
  totalMs: number;
  tokens: { input: number; cached: number; output: number; thoughts: number };
  usd: number;
  finishReason: string;
  promptVersion: string;
  /** Null for answers logged before traces were kept. */
  trace: AnswerTrace | null;
  corpusKey: string | null;
  /** The deterministic checks' flags (`server/src/ask/checks.ts`); null on older answers. */
  checks: { v: 1; flags: string[] } | null;
  feedback: 1 | -1 | null;
}

export type ConversationFilter = "all" | "down" | "unknown" | "failed" | "dropped" | "flagged";

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
  /** The judge's model; null when the run was not judged. */
  judge: string | null;
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

export const REVIEW_LABELS = ["correct", "grounded", "helpful", "tone", "language"] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];
/** true = good, false = not, null = does not apply. */
export type ReviewLabels = Record<ReviewLabel, boolean | null>;

export interface ReviewEntry {
  /** The answer, as Conversations shows it. */
  message: ConversationRow;
  /** Why it is in the queue whatever the sample: check flags, a thumbs-down, "didn't know". */
  reasons: string[];
  /** Drawn by the week's random sample. */
  sampled: boolean;
  review: { labels: ReviewLabels; note: string | null; reviewedAt: string } | null;
}

/** One ISO week's review queue (`server/src/ask/reviews.ts`). */
export interface ReviewQueue {
  week: string;
  previous: string;
  /** Null for the current week. */
  next: string | null;
  queue: ReviewEntry[];
  stats: {
    answers: number;
    queued: number;
    reviewed: number;
    labels: Record<ReviewLabel, { good: number; bad: number }>;
  };
}

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted";

/** A background run (`server/src/ask/runs/`): an eval suite today. */
export interface RunRow {
  id: string;
  kind: "eval" | "pairwise" | "judge" | "insights" | "agent";
  status: RunStatus;
  params: Record<string, unknown>;
  progress: { total: number; done: number; failed: number; unavailable: number };
  /** An eval run's summary, without the per-case results (those are the items). */
  summary: Omit<EvalSummary, "results"> | null;
  usd: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  /** True while a worker in the API is running it now. */
  live: boolean;
}

export interface RunItem {
  key: string;
  position: number;
  status: "pending" | "running" | "done" | "failed" | "unavailable";
  result: EvalCaseResult | null;
  attempts: number;
  usd: number;
  updatedAt: string;
}

export type CopilotInput =
  | { task: "translate"; text: string; from: Locale; to: Locale; html?: boolean }
  | { task: "tighten"; text: string; locale: Locale; maxLength?: number }
  | { task: "seo"; text: string; locale: Locale; maxLength?: number }
  | { task: "faq-answer"; question: string; locale: Locale }
  /** Alt text for an uploaded image, from the picture itself (a model that sees images). */
  | { task: "alt"; mediaId: string; locale: Locale };
