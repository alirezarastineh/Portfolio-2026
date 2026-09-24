import type { AskMessage } from "./ask-types";

/**
 * Each question's answer: the assistant message right after it, by the
 * question's id.
 *
 * The AI SDK streams into one message object and mutates it in place, and
 * `@ai-sdk/angular` hands that same object over on every chunk. A component
 * input given an identical object sees no change, so the answer's memoized
 * rendering kept its first, empty state until a reload. The newest answer —
 * the only one that can still be streaming — is therefore passed as a fresh
 * copy each time; older answers keep their identity and do not re-render.
 */
export function answersByQuestion(messages: readonly AskMessage[]): Map<string, AskMessage> {
  const map = new Map<string, AskMessage>();
  const newest = messages.length - 1;
  messages.forEach((m, i) => {
    const next = messages[i + 1];
    if (m.role !== "user" || next?.role !== "assistant") return;
    map.set(m.id, i + 1 === newest ? { ...next, parts: [...next.parts] } : next);
  });
  return map;
}
