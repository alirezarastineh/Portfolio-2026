import { isToolUIPart } from "ai";

import type { AskMessage } from "./ask-types";

/**
 * The summary an answer's hand-off offer fills the contact form with, or null
 * when it offers none (visitor plan V6). The server's word comes first: its
 * metadata holds the model's summary once checked, the visitor's own words in
 * its place, or the server's own offer when the model made none. An answer
 * from an older server has only the tool's input.
 */
export function handoffSummary(message: Pick<AskMessage, "metadata" | "parts">): string | null {
  const offered = message.metadata?.handoff?.summary?.trim();
  if (offered) return offered;
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.type !== "tool-handoff_contact") continue;
    if (part.state !== "output-available") continue;
    const summary = (part.input as { summary?: unknown } | undefined)?.summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return null;
}
