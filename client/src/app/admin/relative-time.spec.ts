import { describe, expect, it } from "vitest";

import { relativeTime } from "./relative-time";

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("relativeTime", () => {
  it("says just now for the last few seconds", () => {
    expect(relativeTime(ago(10), NOW)).toBe("just now");
  });

  it("rounds to the largest unit that fits", () => {
    expect(relativeTime(ago(50), NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(40 * 60), NOW)).toBe("40 minutes ago");
    expect(relativeTime(ago(3 * 3600), NOW)).toBe("3 hours ago");
    expect(relativeTime(ago(26 * 3600), NOW)).toBe("yesterday");
    expect(relativeTime(ago(9 * 24 * 3600), NOW)).toBe("last week");
  });

  it("reads a time in the future as one", () => {
    expect(relativeTime(new Date(NOW + 2 * 3600 * 1000).toISOString(), NOW)).toBe("in 2 hours");
  });
});
