import { describe, expect, it } from "vitest";

import { isWebLink } from "./social";

describe("isWebLink", () => {
  it("is true for http(s) only", () => {
    expect(isWebLink("https://x.com/a")).toBe(true);
    expect(isWebLink("HTTP://x.com")).toBe(true);
    expect(isWebLink("mailto:a@b.c")).toBe(false);
  });
});
