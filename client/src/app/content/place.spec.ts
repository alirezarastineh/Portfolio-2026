import { describe, expect, it } from "vitest";

import { regionName, timeZoneLabel } from "./place";

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
