import { namesDocument, requestedId } from "./perception.js";
import type { AnswerTrace } from "./trace.js";

/**
 * How the tools fare (plan phase 21), from a window of answers' traces: each
 * tool's calls per answer, how its calls ended (the outcome taxonomy:
 * not_found, not_allowed, no_hits, a duplicate, the budget spent), and how
 * often what it returned was then cited. Pure: the admin route loads the rows.
 */

/** One answer as the measure reads it: its trace and what it cited. */
export interface ToolMetricsRow {
  trace: AnswerTrace | null;
  citedIds: readonly string[];
}

export type MeasuredOutcome =
  | "ok"
  | "not_found"
  | "not_allowed"
  | "no_hits"
  | "duplicate"
  | "budget_exhausted"
  | "error"
  | "cut-off";

export interface ToolStats {
  name: string;
  calls: number;
  /** Over every traced answer in the window, whether it called the tool or not. */
  callsPerAnswer: number | null;
  outcomes: Partial<Record<MeasuredOutcome, number>>;
  /**
   * Of the calls that returned documents (a search's hits, a fetched
   * document, the CV), the share whose answer cited one of them; null for a
   * tool that returns none.
   */
  citedAfter: number | null;
}

export interface ToolMetrics {
  answers: number;
  tools: ToolStats[];
}

/** The tools whose result is documents an answer can cite. */
const RETURNING = new Set(["search_portfolio", "get_document", "get_resume"]);

/** The documents a call returned (a search's hits, the fetched document, the CV). */
function returned(tool: AnswerTrace["steps"][number]["tools"][number]): string[] {
  if (tool.outcome !== "ok") return [];
  if (tool.name === "search_portfolio") return tool.hits ?? [];
  if (tool.name === "get_resume") return ["cv"];
  const id = tool.name === "get_document" ? requestedId(tool.input) : null;
  return id ? [id] : [];
}

interface Tally {
  calls: number;
  outcomes: Partial<Record<MeasuredOutcome, number>>;
  /** Calls that returned documents, and of those, the ones the answer cited from. */
  returning: number;
  cited: number;
}

export function measureTools(rows: readonly ToolMetricsRow[]): ToolMetrics {
  const traced = rows.filter((row) => row.trace);
  const stats = new Map<string, Tally>();
  for (const row of traced) {
    // Whatever language the answer cited a document in, it is the document; a fetched id the
    // trace redacted (a long digit run) is matched back as Perception's fetch counts do.
    const wasCited = (id: string) => row.citedIds.some((cited) => namesDocument(id, cited));
    for (const step of row.trace!.steps) {
      for (const tool of step.tools) {
        const entry = stats.get(tool.name) ?? { calls: 0, outcomes: {}, returning: 0, cited: 0 };
        entry.calls++;
        entry.outcomes[tool.outcome] = (entry.outcomes[tool.outcome] ?? 0) + 1;
        const ids = returned(tool);
        if (ids.length) {
          entry.returning++;
          if (ids.some(wasCited)) entry.cited++;
        }
        stats.set(tool.name, entry);
      }
    }
  }
  return {
    answers: traced.length,
    tools: [...stats]
      .sort(([a, x], [b, y]) => y.calls - x.calls || a.localeCompare(b))
      .map(([name, s]) => ({
        name,
        calls: s.calls,
        callsPerAnswer: traced.length ? s.calls / traced.length : null,
        outcomes: s.outcomes,
        citedAfter: RETURNING.has(name) && s.returning ? s.cited / s.returning : null,
      })),
  };
}
