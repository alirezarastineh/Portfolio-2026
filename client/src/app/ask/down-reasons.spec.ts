import { describe, expect, it } from "vitest";

import { DOWN_REASONS } from "./ask-types";
import { feedbackBody, reasonChoices, withDownReason } from "./down-reasons";

describe("a thumbs-down's reason", () => {
  it("is kept with a -1, cleared by a +1 or a -1 without one, and leaves other answers alone", () => {
    const before = { m_other: "length" as const };
    const wrong = withDownReason(before, "m_1", -1, "wrong");
    expect(wrong).toEqual({ m_other: "length", m_1: "wrong" });
    expect(withDownReason(wrong, "m_1", -1, "unanswered")).toEqual({
      m_other: "length",
      m_1: "unanswered",
    });
    expect(withDownReason(wrong, "m_1", -1)).toEqual(before);
    expect(withDownReason(wrong, "m_1", 1, "wrong")).toEqual(before);
    // The map it came from is untouched.
    expect(before).toEqual({ m_other: "length" });
  });

  it("goes to the server with a -1 only", () => {
    expect(feedbackBody("s", "m_1", -1, "wrong")).toEqual({
      sessionId: "s",
      messageId: "m_1",
      value: -1,
      reason: "wrong",
    });
    expect(feedbackBody("s", "m_1", -1)).toEqual({ sessionId: "s", messageId: "m_1", value: -1 });
    expect(feedbackBody("s", "m_1", 1, "wrong")).toEqual({
      sessionId: "s",
      messageId: "m_1",
      value: 1,
    });
  });

  it("offers all three until one is chosen, then that one", () => {
    expect(reasonChoices(null)).toEqual(DOWN_REASONS);
    expect(reasonChoices("length")).toEqual(["length"]);
  });
});
