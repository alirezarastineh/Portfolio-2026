import { describe, expect, it } from "vitest";

import type { AskMessage } from "./ask-types";
import { handoffSummary } from "./handoff-offer";

type Part = AskMessage["parts"][number];

const words: Part = { type: "text", text: "Happy to help: confirm below." };

function toolPart(state: "input-available" | "output-available", input: unknown): Part {
  return {
    type: "tool-handoff_contact",
    toolCallId: "call-1",
    state,
    input,
    ...(state === "output-available" ? { output: { ok: true, awaitingConfirmation: true } } : {}),
  } as Part;
}

describe("handoffSummary (visitor plan V6)", () => {
  it("takes the server's summary first: the checked one, or the visitor's words", () => {
    expect(
      handoffSummary({
        metadata: { handoff: { by: "tool", summary: " I'd like to hire him. " } },
        parts: [words, toolPart("output-available", { summary: "Sent your CV to Alireza." })],
      }),
    ).toBe("I'd like to hire him.");
  });

  it("makes the server's own offer when no tool part made one", () => {
    expect(
      handoffSummary({
        metadata: { handoff: { by: "fallback", summary: "How do we start?" } },
        parts: [words],
      }),
    ).toBe("How do we start?");
  });

  it("falls back to the tool's input for an answer from an older server", () => {
    expect(
      handoffSummary({
        parts: [words, toolPart("output-available", { summary: "Wants to hire him." })],
      }),
    ).toBe("Wants to hire him.");
  });

  it("offers nothing without an offer, a finished tool call or a summary", () => {
    expect(handoffSummary({ parts: [words] })).toBeNull();
    expect(
      handoffSummary({ parts: [toolPart("input-available", { summary: "Wants to hire him." })] }),
    ).toBeNull();
    expect(handoffSummary({ parts: [toolPart("output-available", { summary: "  " })] })).toBeNull();
    expect(handoffSummary({ parts: [toolPart("output-available", undefined)] })).toBeNull();
    expect(
      handoffSummary({ metadata: { handoff: { by: "tool", summary: " " } }, parts: [words] }),
    ).toBeNull();
  });
});
