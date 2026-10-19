// A deliberate failing assertion for a scratch red (the GitHub Actions plan,
// Phase 4): never merge.
import { describe, expect, it } from "vitest";

describe("ci red", () => {
  it("fails on purpose", () => {
    expect(1 + 1).toBe(3);
  });
});
