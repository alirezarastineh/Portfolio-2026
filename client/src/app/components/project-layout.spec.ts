import { describe, expect, it } from "vitest";

import { cardLayouts } from "./project-layout";

const of = (...featured: boolean[]) => cardLayouts(featured.map((f) => ({ featured: f })));

describe("cardLayouts", () => {
  it("puts non-featured projects two across", () => {
    expect(of(false, false)).toEqual(["half", "half"]);
    expect(of(true, false, false)).toEqual(["featured", "half", "half"]);
  });

  it("widens the last card of an odd run instead of leaving it alone", () => {
    expect(of(false, false, false)).toEqual(["half", "half", "wide"]);
    expect(of(false)).toEqual(["wide"]);
    expect(of(true, false)).toEqual(["featured", "wide"]);
  });

  it("counts each run between featured projects on its own", () => {
    expect(of(false, true, false)).toEqual(["wide", "featured", "wide"]);
    expect(of(false, false, true, false, false, false)).toEqual([
      "half",
      "half",
      "featured",
      "half",
      "half",
      "wide",
    ]);
  });

  it("handles featured-only and empty lists", () => {
    expect(of(true, true)).toEqual(["featured", "featured"]);
    expect(of()).toEqual([]);
  });
});
