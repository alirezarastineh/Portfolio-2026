/**
 * Umami events for the assistant — names and where they came from, never
 * content. A no-op when the tracker is not loaded (dev, previews, visitors
 * with Do Not Track).
 */
export type AskEvent =
  | "ask_open"
  | "ask_send"
  | "ask_answer"
  | "ask_citation_click"
  | "ask_handoff"
  | "ask_feedback"
  // What visitors do with an answer (visitor plan V2).
  | "ask_followup"
  | "ask_stop"
  | "ask_copy"
  // How an answer was made, asked for (visitor plan V12).
  | "ask_inspect";

export function track(event: AskEvent, data?: Record<string, string>): void {
  try {
    (
      globalThis as { umami?: { track?: (name: string, data?: Record<string, string>) => void } }
    ).umami?.track?.(event, data);
  } catch {
    // Analytics never breaks the terminal.
  }
}
