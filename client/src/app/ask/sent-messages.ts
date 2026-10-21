import type { AskMessage } from "./ask-types";

/** Messages sent back whole: the answers with their signatures, which the server replays. */
const MAX_SENT_MESSAGES = 16;

/**
 * The visitor's questions before those, sent without their answers. The
 * server's window keeps what fits and names what it drops in a note; cut off
 * here, those questions would vanish without a word.
 */
const MAX_EARLIER_QUESTIONS = 12;

/** What the server needs: text, and the signature that lets an answer count as history. */
export function forRequest(messages: readonly AskMessage[]) {
  const earlier = messages
    .slice(0, -MAX_SENT_MESSAGES)
    .filter((m) => m.role === "user")
    .slice(-MAX_EARLIER_QUESTIONS);
  return [...earlier, ...messages.slice(-MAX_SENT_MESSAGES)].map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts.filter((p) => p.type === "text").map((p) => ({ type: "text", text: p.text })),
    ...(m.role === "assistant" && m.metadata?.sig ? { metadata: { sig: m.metadata.sig } } : {}),
  }));
}
