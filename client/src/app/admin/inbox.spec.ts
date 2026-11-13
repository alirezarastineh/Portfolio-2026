import { describe, expect, it } from "vitest";

import {
  actionsFor,
  afterLeaving,
  filterFrom,
  inFilter,
  replyHref,
  statusForKey,
  stepFrom,
  withoutMarks,
} from "./inbox";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("inbox", () => {
  it("keeps spam and the archive out of the inbox", () => {
    expect(inFilter("inbox", "new")).toBe(true);
    expect(inFilter("inbox", "read")).toBe(true);
    expect(inFilter("inbox", "spam")).toBe(false);
    expect(inFilter("inbox", "archived")).toBe(false);
    expect(inFilter("spam", "spam")).toBe(true);
    expect(inFilter("new", "read")).toBe(false);
  });

  it("offers what fits the message's status", () => {
    expect(actionsFor("new").map((a) => a.label)).toEqual(["Mark read", "Archive", "Spam"]);
    expect(actionsFor("read").map((a) => a.status)).toEqual(["new", "archived", "spam"]);
    expect(actionsFor("archived").map((a) => a.label)).toEqual(["Move to inbox", "Spam"]);
    expect(actionsFor("spam").map((a) => a.label)).toEqual(["Not spam", "Archive"]);
  });

  it("opens the next message when one leaves the list, or the one before at the end", () => {
    expect(afterLeaving(list, "a")).toEqual({
      rest: [{ id: "b" }, { id: "c" }],
      next: { id: "b" },
    });
    expect(afterLeaving(list, "c").next).toEqual({ id: "b" });
    expect(afterLeaving([{ id: "a" }], "a")).toEqual({ rest: [], next: null });
    expect(afterLeaving(list, "x").next).toBeNull();
  });

  it("steps through the list with J and K, stopping at the ends", () => {
    expect(stepFrom(list, null, 1)).toEqual({ id: "a" });
    expect(stepFrom(list, "a", 1)).toEqual({ id: "b" });
    expect(stepFrom(list, "c", 1)).toEqual({ id: "c" });
    expect(stepFrom(list, "b", -1)).toEqual({ id: "a" });
    expect(stepFrom(list, "a", -1)).toEqual({ id: "a" });
    expect(stepFrom([], null, 1)).toBeNull();
  });

  it("replies in the message's language, English when it has none", () => {
    expect(replyHref({ email: "ada@example.com", locale: "de" })).toBe(
      "mailto:ada%40example.com?subject=Re%3A%20Ihre%20Nachricht",
    );
    expect(replyHref({ email: "grace@example.com", locale: "en" })).toBe(
      "mailto:grace%40example.com?subject=Re%3A%20your%20message",
    );
    expect(replyHref({ email: "x@example.com", locale: null })).toBe(
      "mailto:x%40example.com?subject=Re%3A%20your%20message",
    );
  });

  it("reads an answer without its citation marks", () => {
    expect(withoutMarks("Yes: Atlas cut escalations by 38% [^project:atlas@en].")).toBe(
      "Yes: Atlas cut escalations by 38%.",
    );
    expect(withoutMarks("A[^a@en][^b@de] and B.")).toBe("A and B.");
    expect(withoutMarks("No marks.")).toBe("No marks.");
  });

  it("reads the filter from the address, the inbox when it names none it knows", () => {
    expect(filterFrom("spam")).toBe("spam");
    expect(filterFrom(null)).toBe("inbox");
    expect(filterFrom("constructor")).toBe("inbox");
  });

  it("gives E, U and # a status only where the message can take it", () => {
    expect(statusForKey("e", "new")).toBe("archived");
    expect(statusForKey("e", "archived")).toBeNull();
    expect(statusForKey("u", "read")).toBe("new");
    expect(statusForKey("u", "new")).toBeNull();
    expect(statusForKey("#", "read")).toBe("spam");
    expect(statusForKey("#", "spam")).toBeNull();
    expect(statusForKey("x", "read")).toBeNull();
  });
});
