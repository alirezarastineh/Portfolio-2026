import { DOWN_REASONS, type DownReason } from "./ask-types";

/**
 * Why a 👎: one of the codes the terminal offers, kept per answer in the tab and
 * sent with the -1. A reason belongs to a -1 only, as the server keeps it.
 */

/** The reasons after a rating: a -1 with a reason keeps it; anything else clears the answer's. */
export function withDownReason(
  reasons: Readonly<Record<string, DownReason>>,
  messageId: string,
  value: 1 | -1,
  reason?: DownReason,
): Record<string, DownReason> {
  const others = Object.fromEntries(Object.entries(reasons).filter(([id]) => id !== messageId));
  return value === -1 && reason ? { ...others, [messageId]: reason } : others;
}

/** What `/v1/ask/feedback` takes: the reason with a -1 only. */
export function feedbackBody(
  sessionId: string,
  messageId: string,
  value: 1 | -1,
  reason?: DownReason,
): { sessionId: string; messageId: string; value: 1 | -1; reason?: DownReason } {
  return { sessionId, messageId, value, ...(value === -1 && reason ? { reason } : {}) };
}

/** The reasons on offer: all three until one is chosen, then that one. */
export function reasonChoices(chosen: DownReason | null): readonly DownReason[] {
  return chosen ? [chosen] : DOWN_REASONS;
}
