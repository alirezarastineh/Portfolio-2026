import { normaliseQuery } from "./embeddings.js";
import { DOCUMENT_CALLS, DOCUMENT_CHARS, FETCH_CLIP } from "./tool-defs.js";

/**
 * The tools' state for one answer (plan phase 21, the book's budget envelope
 * and duplicate suppression), checked at the tool boundary before any work:
 * the same search or the same document twice is "already provided" (the
 * model has it in the conversation already), and the documents an answer may
 * read are an envelope, at most four and 40,000 characters in all
 * (tool-defs.ts). The document that reaches the 40,000 is cut to what is
 * left; past the envelope a fetch returns `budget_exhausted`, and the model
 * answers with what it has.
 */
export class ToolBudget {
  private readonly searches = new Set<string>();
  private readonly documents = new Set<string>();
  private calls = 0;
  private chars = 0;

  /** True the first time this search (its words, whatever the case or spacing, and kinds) runs. */
  firstSearch(query: string, kinds: readonly string[] = []): boolean {
    const key = `${normaliseQuery(query)}|${[...kinds].sort((a, b) => a.localeCompare(b)).join(",")}`;
    if (this.searches.has(key)) return false;
    this.searches.add(key);
    return true;
  }

  /** Whether this document (by its resolved id) was read already in this answer. */
  hasRead(id: string): boolean {
    return this.documents.has(id);
  }

  /**
   * How many of a document's `length` characters this answer may read: at
   * most `FETCH_CLIP`, and no more than the envelope has left. Null once four
   * documents are read or every character is spent. A read counts as made.
   */
  take(id: string, length: number): number | null {
    const left = DOCUMENT_CHARS - this.chars;
    if (this.calls >= DOCUMENT_CALLS || left <= 0) return null;
    const chars = Math.min(length, FETCH_CLIP, left);
    this.calls++;
    this.chars += chars;
    this.documents.add(id);
    return chars;
  }

  /** What the answer has read so far. */
  spent(): { calls: number; chars: number } {
    return { calls: this.calls, chars: this.chars };
  }
}
