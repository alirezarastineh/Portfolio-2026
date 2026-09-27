import { describe, expect, it } from "vitest";

import { clockTime, regionName, timeZoneLabel } from "./place";

describe("clockTime", () => {
  const at = new Date("2026-07-01T07:05:00Z");

  it("gives the 24-hour time in the zone", () => {
    expect(clockTime("Europe/Berlin", "en", at)).toBe("09:05");
    expect(clockTime("America/New_York", "de", at)).toBe("03:05");
  });

  it("is empty for no zone or an unknown one", () => {
    expect(clockTime("", "en", at)).toBe("");
    expect(clockTime("Mars/Olympus", "en", at)).toBe("");
  });
});

describe("regionName", () => {
  it("names a country code in the page's language", () => {
    expect(regionName("DE", "en")).toBe("Germany");
    expect(regionName("de", "de")).toBe("Deutschland");
  });

  it("passes through anything that is not a two-letter code", () => {
    expect(regionName("", "en")).toBe("");
    expect(regionName("Germany", "en")).toBe("Germany");
  });
});

describe("timeZoneLabel", () => {
  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");

  it("uses the zone's short name, which follows daylight saving", () => {
    expect(timeZoneLabel("Europe/Berlin", "en", winter)).toBe("CET");
    expect(timeZoneLabel("Europe/Berlin", "en", summer)).toBe("CEST");
    expect(timeZoneLabel("Europe/Berlin", "de", summer)).toBe("MESZ");
  });

  it("is empty without a zone or for one the runtime does not know", () => {
    expect(timeZoneLabel("", "en")).toBe("");
    expect(timeZoneLabel("Mars/Olympus", "en")).toBe("");
  });
});
