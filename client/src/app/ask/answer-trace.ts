import type { AnswerTrace } from "./ask-trace.service";
import type { AskMessage } from "./ask-types";

/** Tools that look something up; `navigate` and `handoff_contact` act instead. */
const RETRIEVAL_TOOLS = new Set([
  "search_portfolio",
  "get_document",
  "list_projects",
  "get_resume",
]);

const ESCALATIONS = new Set(["projects-fetched", "search-spans-projects"]);

/** The retrieval tools an answer's parts show, each once, every call counted, and its sources. */
function fromParts(parts: AskMessage["parts"]): {
  tools: string[];
  calls: number;
  sources: number;
} {
  const tools: string[] = [];
  let calls = 0;
  let sources = 0;
  for (const part of parts) {
    const name = part.type.startsWith("tool-") ? part.type.slice("tool-".length) : "";
    if (part.type === "source-url") sources++;
    if (!RETRIEVAL_TOOLS.has(name)) continue;
    calls++;
    if (!tools.includes(name)) tools.push(name);
  }
  return { tools, calls, sources };
}

/** A finished answer, as the hero's trace panel shows it: its parts, and its receipt (V12). */
export function answerTrace(question: string, message: AskMessage): AnswerTrace {
  const meta = message.metadata ?? {};
  const { tools, calls, sources } = fromParts(message.parts);
  const tokens = meta.tokens;
  const receipt = meta.receipt;
  const escalation = receipt?.escalation;
  return {
    question,
    route: meta.route ?? null,
    escalation: escalation && ESCALATIONS.has(escalation) ? escalation : null,
    model: meta.model ?? null,
    fallback: meta.fallback === true,
    ttftMs: typeof meta.ttftMs === "number" ? meta.ttftMs : null,
    totalMs: typeof meta.totalMs === "number" ? meta.totalMs : null,
    tools,
    // The server's count where it sent one; the tool steps the answer showed otherwise.
    lookups: typeof receipt?.lookups === "number" ? receipt.lookups : calls,
    sources,
    removed: typeof receipt?.removed === "number" ? receipt.removed : 0,
    cachedPct: tokens && tokens.input > 0 ? Math.round((tokens.cached / tokens.input) * 100) : null,
  };
}
