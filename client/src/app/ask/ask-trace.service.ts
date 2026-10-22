import { Injectable, signal } from "@angular/core";

/**
 * What the visitor's last answer did, as the hero's trace panel replays it:
 * only facts the answer's own metadata carries, nothing estimated.
 */
export interface AnswerTrace {
  question: string;
  route: "lite" | "deep" | null;
  /** Why it moved from the fast to the thorough model mid-way (visitor plan V12); null if not. */
  escalation: "projects-fetched" | "search-spans-projects" | null;
  model: string | null;
  fallback: boolean;
  ttftMs: number | null;
  totalMs: number | null;
  /** The retrieval tools it called, in order, each once. */
  tools: string[];
  /** Its lookups, every call counted (visitor plan V12). */
  lookups: number;
  /** Sources cited, each checked against the site's content by the server. */
  sources: number;
  /** Invented references the server removed before the visitor saw them (visitor plan V12). */
  removed: number;
  /** Share of the prompt served from the model's cache. */
  cachedPct: number | null;
}

/**
 * Carries the last answer's trace from the terminal (loaded lazily) to the
 * trace panel (in the first load). Nothing else about the conversation.
 */
@Injectable({ providedIn: "root" })
export class AskTraceService {
  private readonly _last = signal<(AnswerTrace & { id: number }) | null>(null);
  readonly last = this._last.asReadonly();

  record(trace: AnswerTrace): void {
    this._last.update((previous) => ({ ...trace, id: (previous?.id ?? 0) + 1 }));
  }
}
