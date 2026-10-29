import type { aiMessages } from "../db/schema.js";
import { CHECK_FLAGS } from "./checks.js";
import type { LeakKind } from "./leak-guard.js";
import type { AttemptOutcome } from "./models/fallback.js";
import { shortName } from "./models/registry.js";
import { TOOL_NAMES, type ToolName } from "./tools.js";
import type { AnswerTrace, TraceStep, TraceTool } from "./trace.js";

/**
 * `inspect` (visitor plan V12): what the log keeps of one of the visitor's
 * own answers, as they may see it. A projection of the stored row, built field
 * by field: the route and its reason, each step's model, time and tokens and
 * the models passed over, each lookup with the visitor's own search words or
 * the document id, the citations kept and how many were removed, what the
 * output guard removed by kind and count, the checks' flags, and the page,
 * focus, level and repair. Never thoughts (none are stored), instruction
 * text, a provider's error message or an address: the row's attempts, with
 * their errors, are not read, and nothing unlisted below leaves.
 */

export type InspectRow = Pick<
  typeof aiMessages.$inferSelect,
  | "id"
  | "createdAt"
  | "promptVersion"
  | "route"
  | "model"
  | "ttftMs"
  | "totalMs"
  | "citedIds"
  | "droppedCitations"
  | "checks"
  | "trace"
>;

export interface InspectTool {
  /** One of the assistant's tools; `unknown` for a name the model made up (model text). */
  name: ToolName | "unknown";
  /** The search words, the document id or the page path it asked for; absent for the rest. */
  input?: string;
  outcome: TraceTool["outcome"];
  /** The size of what came back, in characters. */
  chars: number;
}

export interface InspectStep {
  /** The model that answered the step, by its short name; null when none could. */
  model: string | null;
  /** Its time to the first token. */
  ttftMs: number | null;
  tokens: { input: number; cached: number; output: number } | null;
  /** The models tried before it, and why they were passed over. */
  passedOver: { model: string; outcome: AttemptOutcome; ms: number }[];
  tools: InspectTool[];
}

export interface InspectView {
  v: 1;
  id: string;
  /** When it was answered, ISO 8601. */
  at: string;
  /** The prompt it ran on: the version the public scorecard's recorded run names. */
  prompt: string;
  /** `lite`, `deep`, `lite→deep` or `answer-only`. */
  route: string;
  /** The router's reason, in its codes (`compare`, `default+lookup`…); null on old rows. */
  reason: string | null;
  model: string | null;
  ttftMs: number | null;
  totalMs: number;
  steps: InspectStep[];
  /** The documents cited, each checked against the corpus; how many invented ones were removed. */
  citations: { kept: string[]; removed: number };
  /** What the output guard removed, by kind and count. */
  guard: Partial<Record<LeakKind, number>>;
  /** The deterministic checks' flags (checks.ts). */
  flags: (typeof CHECK_FLAGS)[number][];
  escalation?: NonNullable<AnswerTrace["escalation"]>;
  careful?: NonNullable<NonNullable<AnswerTrace["routing"]>["sensitive"]>;
  page?: NonNullable<AnswerTrace["page"]>;
  focus?: NonNullable<AnswerTrace["focus"]>;
  level?: NonNullable<AnswerTrace["level"]>;
  repair?: NonNullable<AnswerTrace["repair"]>;
}

type Listed = "shown" | "withheld";

/**
 * Every field of the stored trace, and whether `inspect` shows it. A field
 * added to the trace does not compile until it is listed here; the
 * projection's test lists what each shown one becomes.
 */
export const TRACE_FIELDS = {
  v: "withheld",
  steps: "shown",
  // The core's layout and size: the admin's measure of perception.
  core: "withheld",
  routing: "shown",
  escalation: "shown",
  // The earlier questions the window dropped: told to the model, not a fact about the answer.
  window: "withheld",
  repair: "shown",
  // The visitor saw the offer itself; whether its summary was replaced is the gate's measure.
  handoff: "withheld",
  page: "shown",
  focus: "shown",
  level: "shown",
  guard: "shown",
  // A tour's plan, how it was checked and repaired (visitor plan V16): the admin's measure.
  tour: "withheld",
  // A match's items, hits and the critic's verdicts (visitor plan V19): the admin's measure.
  match: "withheld",
} as const satisfies Record<keyof AnswerTrace, Listed>;

export const STEP_FIELDS = {
  model: "shown",
  answerOnly: "withheld",
  ttftMs: "shown",
  tokens: "shown",
  finishReason: "withheld",
  passedOver: "shown",
  tools: "shown",
} as const satisfies Record<keyof TraceStep, Listed>;

export const TOOL_FIELDS = {
  name: "shown",
  input: "shown",
  outcome: "shown",
  resultChars: "shown",
  hits: "withheld",
  semantic: "withheld",
} as const satisfies Record<keyof TraceTool, Listed>;

/** The one input of each tool a visitor may see again; the others' inputs stay out. */
const TOOL_INPUTS: Partial<Record<ToolName, string>> = {
  search_portfolio: "query",
  get_document: "id",
  list_projects: "text",
  navigate: "to",
};

const INPUT_CHARS = 200;
const LEAK_KINDS: readonly LeakKind[] = ["canary", "instructions", "secret"];

function toolName(name: string): InspectTool["name"] {
  return (TOOL_NAMES as readonly string[]).includes(name) ? (name as ToolName) : "unknown";
}

/** The tool's listed input from the stored (redacted, cut) JSON; nothing if it does not parse. */
function toolInput(tool: TraceTool): string | undefined {
  const key = TOOL_INPUTS[toolName(tool.name) as ToolName];
  if (!key) return undefined;
  try {
    const value = (JSON.parse(tool.input) as Record<string, unknown> | null)?.[key];
    return typeof value === "string" && value ? value.slice(0, INPUT_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

function step(trace: TraceStep, inputs: boolean): InspectStep {
  return {
    model: trace.model === null ? null : shortName(trace.model),
    ttftMs: trace.ttftMs,
    tokens: trace.tokens
      ? { input: trace.tokens.input, cached: trace.tokens.cached, output: trace.tokens.output }
      : null,
    passedOver: trace.passedOver.map((p) => ({
      model: shortName(p.model),
      outcome: p.outcome,
      ms: p.ms,
    })),
    tools: trace.tools.map((tool) => {
      const input = inputs ? toolInput(tool) : undefined;
      return {
        name: toolName(tool.name),
        ...(input === undefined ? {} : { input }),
        outcome: tool.outcome,
        chars: tool.resultChars,
      };
    }),
  };
}

export function inspectView(row: InspectRow): InspectView {
  const trace = row.trace;
  const flags = (row.checks?.flags ?? []).filter((flag) => CHECK_FLAGS.includes(flag));
  // A leak may have reached a tool's input, which the guard cannot filter (checks.ts):
  // then no input is shown again.
  const inputs = !flags.includes("leak");
  return {
    v: 1,
    id: row.id,
    at: row.createdAt.toISOString(),
    prompt: row.promptVersion,
    route: row.route,
    reason: trace?.routing?.reason ?? null,
    model: row.model === null ? null : shortName(row.model),
    ttftMs: row.ttftMs,
    totalMs: row.totalMs,
    steps: (trace?.steps ?? []).map((s) => step(s, inputs)),
    citations: { kept: [...row.citedIds], removed: row.droppedCitations.length },
    guard: Object.fromEntries(
      LEAK_KINDS.flatMap((kind) => {
        const count = trace?.guard?.[kind];
        return typeof count === "number" && count > 0 ? [[kind, count]] : [];
      }),
    ),
    flags,
    ...(trace?.escalation
      ? { escalation: { step: trace.escalation.step, reason: trace.escalation.reason } }
      : {}),
    ...(trace?.routing?.sensitive ? { careful: trace.routing.sensitive } : {}),
    ...(trace?.page ? { page: { id: trace.page.id, promoted: trace.page.promoted } } : {}),
    ...(trace?.focus ? { focus: { kind: trace.focus.kind, verified: trace.focus.verified } } : {}),
    ...(trace?.level ? { level: trace.level } : {}),
    ...(trace?.repair ? { repair: { reason: trace.repair.reason, by: trace.repair.by } } : {}),
  };
}
