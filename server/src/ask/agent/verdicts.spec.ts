import { describe, expect, it } from "vitest";

import { criticNotes, verdictOn } from "./verdicts.js";

describe("what became of an agent's draft (verdicts.ts)", () => {
  it("reads the draft as kept, edited by its distance, or discarded for a rewrite", () => {
    expect(verdictOn("A new hook.", "  A new\nhook. ")).toEqual({ outcome: "kept" });
    expect(verdictOn("A new hook for search.", "A new hook for fast search.")).toEqual({
      outcome: "edited",
      distance: 1,
    });
    // Under half the draft's words kept in order: the admin wrote their own.
    expect(verdictOn("A new hook for search.", "Something else entirely, by hand.")).toEqual({
      outcome: "discarded",
      distance: 10,
    });
    // Words kept out of order are not kept: the order counts.
    expect(verdictOn("one two three four", "four three two one")).toEqual({
      outcome: "discarded",
      distance: 6,
    });
  });

  it("past four million word pairs, counts shared words as a multiset (an upper bound)", () => {
    const words = Array.from({ length: 2001 }, (_, i) => `w${i}`);
    // 2001 × 2001 pairs: the same words in reverse order read as kept words, edited once.
    expect(verdictOn(words.join(" "), [...words].reverse().join(" "))).toEqual({
      outcome: "edited",
      distance: 1,
    });
    // Still a rewrite when the words are others.
    const others = words.map((w) => `${w}x`).join(" ");
    expect(verdictOn(words.join(" "), others)).toMatchObject({ outcome: "discarded" });
  });

  it("puts a second reading's notes as the admin reads them, and nothing without notes", () => {
    expect(criticNotes(null)).toEqual([]);
    expect(criticNotes({ result: "ok", notes: [] })).toEqual([]);
    expect(criticNotes({ result: "revised", notes: ["A term was off."] })).toEqual([
      "A second reading changed it: A term was off.",
    ]);
    expect(criticNotes({ result: "refused", notes: ["A term was off."] })).toEqual([
      "A second reading found: A term was off. Its revision was not kept.",
    ]);
  });
});
