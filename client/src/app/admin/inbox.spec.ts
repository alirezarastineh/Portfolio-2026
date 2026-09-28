import { describe, expect, it } from "vitest";

import { actionsFor, afterLeaving, inFilter, stepFrom } from "./inbox";

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
});
