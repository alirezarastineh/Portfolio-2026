/**
 * Umami events for the assistant — names only, never content. A no-op when
 * the tracker is not loaded (dev, previews, visitors with Do Not Track).
 */
export type AskEvent =
  "ask_open" | "ask_send" | "ask_answer" | "ask_citation_click" | "ask_handoff" | "ask_feedback";

export function track(event: AskEvent): void {
  try {
    (globalThis as { umami?: { track?: (name: string) => void } }).umami?.track?.(event);
  } catch {
    // Analytics never breaks the terminal.
  }
}
