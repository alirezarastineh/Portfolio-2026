import type { Locale } from "../content/schema.js";
import type { CoreLayout } from "./corpus/render.js";
import { redact } from "./log.js";
import type { Attempt, AttemptOutcome, Trace } from "./models/fallback.js";
import { tokenCounts, type TokenCounts } from "./models/prices.js";
import type { Escalation, Sensitivity } from "./router.js";
import type { RecordedStep } from "./stream-transforms.js";
import type { ToolOutcome } from "./tools.js";

/**
 * What one answer did, step by step, for the admin's timeline and the audit:
 * which model answered each step and which it passed over first (skipped or
 * failed), what each step cost in tokens, and which tools it called, with
 * what input and what came back. Stored with the answer's row (`trace`) and
 * pruned with it.
 */

const INPUT_CHARS = 300;

export interface TraceTool {
  name: string;
  /** The call's input as JSON, redacted and cut to 300 characters. */
  input: string;
  /** `cut-off` when no result arrived: the answer ended first. */
  outcome: ToolOutcome | "cut-off";
  /** Size of the result the model got back, in characters of JSON. */
  resultChars: number;
  /** A search's documents (at most 6) and whether by meaning too (plan phase 18). */
  hits?: string[];
  semantic?: boolean;
}

export interface TraceStep {
  /** The model that answered this step; null when none could. */
  model: string | null;
  answerOnly: boolean;
  ttftMs: number | null;
  tokens: TokenCounts | null;
  finishReason: string | null;
  /** Models tried before it and passed over: skipped (breaker open, too small, no tools) or failed. */
  passedOver: { model: string; outcome: AttemptOutcome; ms: number }[];
  tools: TraceTool[];
}

export interface AnswerTrace {
  v: 1;
  steps: TraceStep[];
  /**
   * The core the answer read (plan phase 16): its language, layout and size.
   * Missing on answers from before, which all read one core with both languages.
   */
  core?: { locale: Locale; layout: CoreLayout; tokens: number };
  /**
   * How the router sent the answer (plan phase 20, router.ts): its reason,
   * and the careful topic or the lookup tier when it had one. Missing on
   * answers from before.
   */
  routing?: { reason: string; sensitive?: Sensitivity; lookup?: true };
  /**
   * The step from which an answer routed lite ran on the deep chain, and why
   * (plan phase 20, router.ts); absent when it did not move.
   */
  escalation?: { step: number; reason: Escalation };
  /**
   * The visitor's earlier questions the conversation window no longer showed
   * (plan phase 22): what the note before the history named, 0 for none.
   * Absent for an answer without a history (an eval) and from before the phase.
   */
  window?: { dropped: number };
}

function inputText(input: unknown): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    json = undefined;
  }
  return redact(json ?? "").slice(0, INPUT_CHARS);
}

function passedOver(attempts: readonly Attempt[]): TraceStep["passedOver"] {
  return attempts
    .filter((a) => a.outcome !== "ok")
    .map(({ model, outcome, ms }) => ({ model, outcome, ms }));
}

/**
 * The recorder's steps joined with the fallback wrapper's trace. Every step
 * is one successful model call (`trace.calls`, in order), and its attempts end
 * with that call's `ok`: what came before the `ok` was passed over. Attempts
 * after the last `ok` are a step no model could answer.
 */
export function buildAnswerTrace(
  recorded: readonly RecordedStep[],
  trace: Trace,
  core?: AnswerTrace["core"],
  route?: Pick<AnswerTrace, "routing" | "escalation" | "window">,
): AnswerTrace {
  const segments: Attempt[][] = [[]];
  for (const attempt of trace.attempts) {
    segments.at(-1)!.push(attempt);
    if (attempt.outcome === "ok") segments.push([]);
  }

  const steps: TraceStep[] = trace.calls.map((call, i) => ({
    model: call.model,
    answerOnly: call.answerOnly,
    ttftMs: call.ttftMs,
    tokens: call.usage ? tokenCounts(call.usage) : null,
    finishReason: recorded[i]?.finishReason ?? call.finishReason,
    passedOver: passedOver(segments[i] ?? []),
    tools: (recorded[i]?.tools ?? []).map((tool) => ({
      name: tool.name,
      input: inputText(tool.input),
      outcome: tool.outcome ?? "cut-off",
      resultChars: tool.resultChars,
      ...(tool.search ? { hits: tool.search.hits, semantic: tool.search.semantic } : {}),
    })),
  }));

  const unanswered = segments[trace.calls.length] ?? [];
  if (unanswered.length) {
    steps.push({
      model: null,
      answerOnly: false,
      ttftMs: null,
      tokens: null,
      finishReason: null,
      passedOver: passedOver(unanswered),
      tools: [],
    });
  }
  return {
    v: 1,
    steps,
    ...(core ? { core } : {}),
    ...(route?.routing ? { routing: route.routing } : {}),
    ...(route?.escalation ? { escalation: route.escalation } : {}),
    // Zero included: an answer from before plan phase 22 has none, and is not counted untrimmed.
    ...(route?.window ? { window: route.window } : {}),
  };
}
