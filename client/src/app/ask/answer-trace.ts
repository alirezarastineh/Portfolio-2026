import type { AnswerTrace } from "./ask-trace.service";
import type { AskMessage } from "./ask-types";

/** Tools that look something up; `navigate` and `handoff_contact` act instead. */
const RETRIEVAL_TOOLS = new Set([
  "search_portfolio",
  "get_document",
  "list_projects",
  "get_resume",
]);

/** A finished answer, as the hero's trace panel shows it. */
export function answerTrace(question: string, message: AskMessage): AnswerTrace {
  const meta = message.metadata ?? {};
  const tools: string[] = [];
  let sources = 0;
  for (const part of message.parts) {
    if (part.type === "source-url") {
      sources++;
    } else if (part.type.startsWith("tool-")) {
      const name = part.type.slice("tool-".length);
      if (RETRIEVAL_TOOLS.has(name) && !tools.includes(name)) tools.push(name);
    }
  }
  const tokens = meta.tokens;
  return {
    question,
    route: meta.route ?? null,
    model: meta.model ?? null,
    fallback: meta.fallback === true,
    ttftMs: typeof meta.ttftMs === "number" ? meta.ttftMs : null,
    totalMs: typeof meta.totalMs === "number" ? meta.totalMs : null,
    tools,
    sources,
    cachedPct: tokens && tokens.input > 0 ? Math.round((tokens.cached / tokens.input) * 100) : null,
  };
}
