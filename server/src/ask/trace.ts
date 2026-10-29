import type { Locale } from "../content/schema.js";
import type { RepairReason } from "./checks.js";
import type { CoreLayout } from "./corpus/render.js";
import type { LeakKind } from "./leak-guard.js";
import { redact } from "./log.js";
import type { Attempt, AttemptOutcome, Trace } from "./models/fallback.js";
import { tokenCounts, type TokenCounts } from "./models/prices.js";
import type { Escalation, Sensitivity } from "./router.js";
import type { RecordedStep, RecordedToolCall } from "./stream-transforms.js";
import type { ToolOutcome } from "./tools.js";
import type { MatchKind, MatchStatus, MatchStop } from "./match/prompt.js";
import type { TourFallback } from "./tour-prompt.js";

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
   * and the careful topic or the lookup tier when it had one, and the
   * visitor's wish to reach him (visitor plan V6). Missing on answers from
   * before.
   */
  routing?: { reason: string; sensitive?: Sensitivity; lookup?: true; intent?: "contact" };
  /**
   * The step from which an answer routed lite ran on the deep chain, and why
   * (plan phase 20, router.ts); absent when it did not move.
   */
  escalation?: { step: number; reason: Escalation };
  /**
   * The visitor's earlier questions the conversation window no longer showed
   * (plan phase 22): what the note before the history named, 0 for none.
   * Absent from before the phase.
   */
  window?: { dropped: number };
  /**
   * The verifier's repair of an answer that had no words (visitor plan V5):
   * why, and who wrote them, one more call on the answer's chain or the fixed
   * closing line. Absent when none was needed.
   */
  repair?: { reason: RepairReason; by: "model" | "fixed-line" };
  /**
   * The hand-off offered (visitor plan V6): by the model's tool, or by the
   * server when the visitor asked to reach him and the model offered nothing;
   * `replaced` when the gate refused the model's summary. `/v1/ask/handoff`
   * accepts a yes to it. Absent when none was offered.
   */
  handoff?: { by: "tool" | "fallback"; replaced?: true };
  /**
   * The case study or post the question was asked on (visitor plan V8): its
   * document, and whether its text was promoted into the page block. Absent
   * on any other page, and from before.
   */
  page?: { id: string; promoted: boolean };
  /**
   * What the visitor pointed at on the page (visitor plan V9): a section, a
   * code block or a selection, and whether the page's document holds it (a
   * section or code block it lacks was ignored; a selection it lacks stayed in
   * the visitor's message). Absent when they pointed at nothing.
   */
  focus?: { kind: "section" | "code" | "selection"; verified: boolean };
  /** The level the visitor chose (visitor plan V10); absent for standard, and from before. */
  level?: "plain" | "expert";
  /**
   * What the output guard removed before the visitor saw it (plan phase 15),
   * each kind with how often, never the text (visitor plan V12, for
   * `inspect`). Absent when it removed nothing, and from before.
   */
  guard?: Partial<Record<LeakKind, number>>;
  /**
   * A tour (visitor plan V16): how many stops the plan had, whether its critic
   * asked for a repair, whether it replaced an earlier tour, why the short tour
   * stood in (no match, no model, an interest read as an injection), and the
   * gates its plans failed. Only on a tour's row.
   */
  tour?: {
    stops: number;
    repaired: boolean;
    replanned: boolean;
    fallback?: TourFallback | "injection";
    failures?: string[];
  };
  /**
   * A matched brief (visitor plan V19): its kind; the plan's items (redacted)
   * with what their searches found and the status each row got, careful or
   * downgraded by the critic; which call was repaired; the gates that failed;
   * why it stopped, if it did. Only on a match's row.
   */
  match?: {
    kind: MatchKind;
    items: {
      text: string;
      priority: "must" | "nice";
      status: MatchStatus | null;
      hits: string[];
      careful?: true;
      downgraded?: true;
    }[];
    repaired: { plan: boolean; rows: boolean };
    failures?: string[];
    stop?: MatchStop;
  };
}

export type RouteMetadata = Pick<
  AnswerTrace,
  | "routing"
  | "escalation"
  | "window"
  | "repair"
  | "handoff"
  | "page"
  | "focus"
  | "level"
  | "guard"
  | "tour"
  | "match"
>;

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

function segmentAttempts(attempts: readonly Attempt[]): Attempt[][] {
  const segments: Attempt[][] = [[]];
  for (const attempt of attempts) {
    segments.at(-1)!.push(attempt);
    if (attempt.outcome === "ok") segments.push([]);
  }
  return segments;
}

function mapTool(tool: RecordedToolCall): TraceTool {
  return {
    name: tool.name,
    input: inputText(tool.input),
    outcome: tool.outcome ?? "cut-off",
    resultChars: tool.resultChars,
    ...(tool.search ? { hits: tool.search.hits, semantic: tool.search.semantic } : {}),
  };
}

function unansweredStep(unanswered: readonly Attempt[]): TraceStep {
  return {
    model: null,
    answerOnly: false,
    ttftMs: null,
    tokens: null,
    finishReason: null,
    passedOver: passedOver(unanswered),
    tools: [],
  };
}

function routeFields(route?: RouteMetadata): Partial<RouteMetadata> {
  if (!route) return {};
  const out: Partial<RouteMetadata> = {};
  for (const [key, value] of Object.entries(route) as [
    keyof RouteMetadata,
    RouteMetadata[keyof RouteMetadata],
  ][]) {
    if (value === undefined) continue;
    if (key === "guard" && Object.keys(value).length === 0) continue;
    out[key] = value as never;
  }
  return out;
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
  route?: RouteMetadata,
): AnswerTrace {
  const segments = segmentAttempts(trace.attempts);

  const steps: TraceStep[] = trace.calls.map((call, i) => ({
    model: call.model,
    answerOnly: call.answerOnly,
    ttftMs: call.ttftMs,
    tokens: call.usage ? tokenCounts(call.usage) : null,
    finishReason: recorded[i]?.finishReason ?? call.finishReason,
    passedOver: passedOver(segments[i] ?? []),
    tools: (recorded[i]?.tools ?? []).map(mapTool),
  }));

  const unanswered = segments[trace.calls.length] ?? [];
  if (unanswered.length) {
    steps.push(unansweredStep(unanswered));
  }

  return {
    v: 1,
    steps,
    ...(core ? { core } : {}),
    ...routeFields(route),
  };
}
