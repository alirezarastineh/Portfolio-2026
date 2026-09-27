/**
 * Umami events for the assistant — names and where they came from, never
 * content. A no-op when the tracker is not loaded (dev, previews, visitors
 * with Do Not Track).
 */
export type AskEvent =
  "ask_open" | "ask_send" | "ask_answer" | "ask_citation_click" | "ask_handoff" | "ask_feedback";

export function track(event: AskEvent, data?: Record<string, string>): void {
  try {
    (
      globalThis as { umami?: { track?: (name: string, data?: Record<string, string>) => void } }
    ).umami?.track?.(event, data);
  } catch {
    // Analytics never breaks the terminal.
  }
}
