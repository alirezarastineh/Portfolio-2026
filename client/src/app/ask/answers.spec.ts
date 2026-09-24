import { describe, expect, it } from "vitest";

import { answersByQuestion } from "./answers";
import type { AskMessage } from "./ask-types";

function message(id: string, role: AskMessage["role"], text: string): AskMessage {
  return { id, role, parts: [{ type: "text", text }] } as AskMessage;
}

describe("answersByQuestion", () => {
  it("pairs each question with the answer after it", () => {
    const map = answersByQuestion([
      message("q1", "user", "hi"),
      message("a1", "assistant", "hello"),
      message("q2", "user", "and?"),
    ]);
    expect([...map.keys()]).toEqual(["q1"]);
    expect(map.get("q1")?.id).toBe("a1");
  });

  it("hands over a new copy of the streaming answer on every update", () => {
    // As the AI SDK does: one message object, its text part mutated in place.
    const streaming = message("a2", "assistant", "");
    const messages = [
      message("q1", "user", "hi"),
      message("a1", "assistant", "hello"),
      message("q2", "user", "and?"),
      streaming,
    ];

    const before = answersByQuestion(messages);
    (streaming.parts[0] as { text: string }).text = "partial answer";
    const after = answersByQuestion([...messages]);

    expect(after.get("q2")).not.toBe(before.get("q2"));
    expect(after.get("q2")?.parts[0]).toMatchObject({ text: "partial answer" });
    // Finished answers keep their identity, so they do not re-render.
    expect(after.get("q1")).toBe(before.get("q1"));
  });
});
