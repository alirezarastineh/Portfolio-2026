import { describe, expect, it } from "vitest";

import { formatDuration, formatMonth, formatPeriod, monthsBetween } from "./period";

const UNITS = { years: "{n} yr", months: "{n} mo" };
const NOW = new Date("2026-09-23T12:00:00Z");

describe("formatMonth / formatPeriod", () => {
  it("prints month and year, or the year alone, in the page's language", () => {
    expect(formatMonth("2024-03-01", "en")).toBe("Mar 2024");
    expect(formatMonth("2024-03-01", "de")).toMatch(/^März 2024$/);
    expect(formatMonth("2024-03-01", "en", "year")).toBe("2024");
  });

  it("uses UTC, so the first of the month never slips into the previous one", () => {
    expect(formatMonth("2024-01-01", "en")).toBe("Jan 2024");
  });

  it("says Present for an ongoing period and collapses identical ends", () => {
    expect(formatPeriod({ start: "2024-03-01", end: null }, "en", "Present")).toBe(
      "Mar 2024 – Present",
    );
    expect(formatPeriod({ start: "2019-01-01", end: "2021-06-01" }, "en", "Present", "year")).toBe(
      "2019 – 2021",
    );
    expect(formatPeriod({ start: "2021-02-01", end: "2021-11-01" }, "en", "Present", "year")).toBe(
      "2021",
    );
  });
});

describe("monthsBetween / formatDuration", () => {
  it("counts both ends, like a CV", () => {
    expect(monthsBetween({ start: "2024-01-01", end: "2024-03-01" }, NOW)).toBe(3);
    expect(monthsBetween({ start: "2024-05-01", end: "2024-05-01" }, NOW)).toBe(1);
  });

  it("runs an ongoing period to now", () => {
    expect(monthsBetween({ start: "2025-09-01", end: null }, NOW)).toBe(13);
    expect(formatDuration({ start: "2025-09-01", end: null }, UNITS, NOW)).toBe("1 yr 1 mo");
  });

  it("leaves out a zero unit", () => {
    expect(formatDuration({ start: "2023-01-01", end: "2024-12-01" }, UNITS, NOW)).toBe("2 yr");
    expect(formatDuration({ start: "2024-01-01", end: "2024-04-01" }, UNITS, NOW)).toBe("4 mo");
  });

  it("gives a year-precision period whole years only", () => {
    expect(formatDuration({ start: "2019-01-01", end: "2021-01-01" }, UNITS, NOW, "year")).toBe(
      "2 yr",
    );
    expect(formatDuration({ start: "2026-01-01", end: null }, UNITS, NOW, "year")).toBe("1 yr");
  });
});
