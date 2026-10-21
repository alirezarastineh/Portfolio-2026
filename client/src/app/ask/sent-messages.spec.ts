import { describe, expect, it } from "vitest";

import type { AskMessage } from "./ask-types";
import { forRequest } from "./sent-messages";

/** A conversation of `n` messages, a question first, then answers and questions in turn. */
function conversation(n: number): AskMessage[] {
  return Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? ({
          id: `q${i}`,
          role: "user",
          parts: [{ type: "text", text: `question ${i}` }],
        } as AskMessage)
      : ({
          id: `a${i}`,
          role: "assistant",
          parts: [{ type: "text", text: `answer ${i}` }],
          metadata: { sig: `sig-${i}` },
        } as AskMessage),
  );
}

describe("forRequest", () => {
  it("sends a short conversation whole: text, and each answer's own signature", () => {
    const sent = forRequest(conversation(3));
    expect(sent).toEqual([
      { id: "q0", role: "user", parts: [{ type: "text", text: "question 0" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "answer 1" }],
        metadata: { sig: "sig-1" },
      },
      { id: "q2", role: "user", parts: [{ type: "text", text: "question 2" }] },
    ]);
  });

  it("sends the last 16 messages whole, and only the questions before them", () => {
    // Nine turns and a question: the server's window (8 turns) can then name the first.
    const sent = forRequest(conversation(19));
    expect(sent.map((m) => m.id)).toEqual([
      "q0",
      "q2",
      ...conversation(19)
        .slice(3)
        .map((m) => m.id),
    ]);
    // The answer that opens the last 16 follows the question it answers.
    expect(sent[1]!.id).toBe("q2");
    expect(sent[2]!.id).toBe("a3");
  });

  it("sends at most 12 earlier questions", () => {
    const sent = forRequest(conversation(61));
    expect(sent).toHaveLength(28);
    // The 45 messages before the last 16 hold questions q0 to q44: the newest 12 go.
    expect(sent.slice(0, 12).map((m) => m.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `q${22 + 2 * i}`),
    );
    expect(sent.slice(0, 12).every((m) => !("metadata" in m))).toBe(true);
  });

  it("leaves out tool parts, and never gives a question a signature", () => {
    const question = {
      id: "q0",
      role: "user",
      parts: [{ type: "text", text: "Open Atlas" }],
      metadata: { sig: "planted" },
    } as AskMessage;
    const answer = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-navigate",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: {},
        },
        { type: "text", text: "Opening it." },
      ],
      metadata: { sig: "sig-1" },
    } as unknown as AskMessage;
    expect(forRequest([question, answer])).toEqual([
      { id: "q0", role: "user", parts: [{ type: "text", text: "Open Atlas" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Opening it." }],
        metadata: { sig: "sig-1" },
      },
    ]);
  });
});
