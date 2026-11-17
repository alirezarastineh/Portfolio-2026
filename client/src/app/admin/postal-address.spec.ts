import { describe, expect, it } from "vitest";

import { hasPostalAddress } from "./postal-address";

describe("hasPostalAddress", () => {
  it("finds a postcode and a town, across tags and a no-break space", () => {
    expect(hasPostalAddress("<p>Musterstraße 1</p><p>10115 Berlin</p>")).toBe(true);
    expect(hasPostalAddress("<p>10115&nbsp;Berlin</p>")).toBe(true);
    expect(hasPostalAddress("<p>Musterweg 2, D-80331 München</p>")).toBe(true);
    expect(hasPostalAddress("<p>12345</p><p>Überlingen</p>")).toBe(true);
  });

  it("finds none in a name alone, a year, a phone number or nothing", () => {
    expect(hasPostalAddress("<h2>Angaben gemäß § 5 DDG</h2><p>Alireza Rastineh</p>")).toBe(false);
    expect(hasPostalAddress("<p>Since 2024 Berlin</p>")).toBe(false);
    expect(hasPostalAddress("<p>Phone 030 12345678 Berlin</p>")).toBe(false);
    expect(hasPostalAddress("")).toBe(false);
    expect(hasPostalAddress("<".repeat(50_000))).toBe(false);
  });
});
