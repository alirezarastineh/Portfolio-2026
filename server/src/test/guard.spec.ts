import { describe, expect, it } from "vitest";

import { assertTestDatabase } from "./guard.js";

describe("assertTestDatabase", () => {
  it("accepts a database named as a test database", () => {
    expect(() =>
      assertTestDatabase("postgresql://u:p@127.0.0.1:61234/portfolio_test"),
    ).not.toThrow();
  });

  /** Dev shares the production database through the tunnel; the suites truncate tables. */
  it("refuses the production tunnel even with a test-looking name", () => {
    expect(() => assertTestDatabase("postgresql://u:p@127.0.0.1:55433/portfolio_test")).toThrow(
      /tunnel/,
    );
  });

  it("refuses a database whose name does not say test", () => {
    expect(() => assertTestDatabase("postgresql://u:p@db:5432/portfolio")).toThrow(/must contain/);
  });
});
