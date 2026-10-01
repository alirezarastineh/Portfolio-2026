import { redact } from "./log.js";
import type { Attempt, AttemptOutcome, Trace } from "./models/fallback.js";
import { tokenCounts, type TokenCounts } from "./models/prices.js";
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
export function buildAnswerTrace(recorded: readonly RecordedStep[], trace: Trace): AnswerTrace {
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
  return { v: 1, steps };
}
