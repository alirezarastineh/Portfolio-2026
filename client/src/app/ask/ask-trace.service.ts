import { Injectable, signal } from "@angular/core";

/**
 * What the visitor's last answer did, as the hero's trace panel replays it:
 * only facts the answer's own metadata carries, nothing estimated.
 */
export interface AnswerTrace {
  question: string;
  route: "lite" | "deep" | null;
  model: string | null;
  fallback: boolean;
  ttftMs: number | null;
  totalMs: number | null;
  /** The retrieval tools it called, in order, each once. */
  tools: string[];
  /** Sources cited, each checked against the site's content by the server. */
  sources: number;
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
