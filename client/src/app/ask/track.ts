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
  | "ask_inspect"
  // The public scorecard, read (visitor plan V13).
  | "ask_evals"
  // The portfolio's map: a read-next page opened or connected, what's new's steps (V15).
  | "map_read_next"
  | "map_news"
  // The guided tour: started (default, interest, replan), a step, the last stop (V16).
  | "tour_start"
  | "tour_step"
  | "tour_done"
  // A link that carries a question, copied (visitor plan V17).
  | "ask_share"
  // A brief's paste box opened, and the brief sent, by kind (visitor plan V20).
  | "match_open"
  | "match_send";

export function track(event: AskEvent, data?: Record<string, string>): void {
  try {
    (
      globalThis as { umami?: { track?: (name: string, data?: Record<string, string>) => void } }
    ).umami?.track?.(event, data);
  } catch {
    // Analytics never breaks the terminal.
  }
}
