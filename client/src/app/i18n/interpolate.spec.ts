import { describe, expect, it } from "vitest";

import { fmt } from "./interpolate";

describe("fmt", () => {
  it("substitutes a named token", () => {
    expect(fmt("At least {n} chars.", { n: 10 })).toBe("At least 10 chars.");
    expect(fmt("Mindestens {n} Zeichen.", { n: 10 })).toBe("Mindestens 10 Zeichen.");
  });

  it("substitutes every occurrence", () => {
    expect(fmt("{a}-{a}-{b}", { a: 1, b: 2 })).toBe("1-1-2");
  });

  /**
   * A missing variable leaves the token visible rather than blanking it, so a
   * bad key in the admin is obvious instead of silently producing "At least
   * chars."
   */
  it("leaves an unknown token intact", () => {
    expect(fmt("At least {nn} chars.", { n: 10 })).toBe("At least {nn} chars.");
  });

  it("passes through copy with no tokens", () => {
    expect(fmt("Required.", { n: 1 })).toBe("Required.");
  });

  it("does not treat replacement text as a further template", () => {
    expect(fmt("{a}", { a: "{a}" })).toBe("{a}");
  });

  it("handles the case label used by project cards", () => {
    expect(fmt("case · {i}", { i: "01" })).toBe("case · 01");
    expect(fmt("fall · {i}", { i: "12" })).toBe("fall · 12");
  });
});
