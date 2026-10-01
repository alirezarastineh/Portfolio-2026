import { describe, expect, it } from "vitest";

import { hasFlag, optionValues } from "./args.js";

describe("the eval CLI's arguments", () => {
  const argv = ["node", "cli.ts", "--case", "fact", "--no-judge", "--case", "tool-open-atlas"];

  it("reads flags and repeated options", () => {
    expect(hasFlag(argv, "no-judge")).toBe(true);
    expect(hasFlag(argv, "update-baseline")).toBe(false);
    expect(optionValues(argv, "case")).toEqual(["fact", "tool-open-atlas"]);
    expect(optionValues(argv, "corpus")).toEqual([]);
  });

  it("never takes the next flag as an option's value", () => {
    const missing = ["--accept-regression", "--update-baseline"];
    expect(optionValues(missing, "accept-regression")).toEqual([]);
    expect(optionValues(["--accept-regression"], "accept-regression")).toEqual([]);
    expect(optionValues(["--accept-regression", "Harder cases."], "accept-regression")).toEqual([
      "Harder cases.",
    ]);
  });
});
