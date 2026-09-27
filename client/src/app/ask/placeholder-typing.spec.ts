import { describe, expect, it } from "vitest";

import { placeholderSteps, TYPING } from "./placeholder-typing";

const take = (starters: string[], n: number) => {
  const steps = placeholderSteps(starters);
  return Array.from({ length: n }, () => steps.next().value);
};

describe("placeholderSteps", () => {
  it("holds the first question, erases it, then types the next and holds it", () => {
    expect(take(["abc", "xy"], 7)).toEqual([
      { text: "abc", wait: TYPING.hold },
      { text: "ab", wait: TYPING.erase },
      { text: "a", wait: TYPING.erase },
      { text: "", wait: TYPING.gap },
      { text: "x", wait: TYPING.type },
      { text: "xy", wait: TYPING.hold },
      { text: "x", wait: TYPING.erase },
    ]);
  });

  it("comes back to the first question after the last", () => {
    const texts = take(["a", "b"], 6).map((s) => s?.text);
    expect(texts).toEqual(["a", "", "b", "", "a", ""]);
  });

  it("keeps a single question still", () => {
    expect(take(["only"], 3).map((s) => s?.text)).toEqual(["only", "only", "only"]);
  });

  it("yields nothing without questions", () => {
    expect(placeholderSteps([]).next().done).toBe(true);
  });
});
