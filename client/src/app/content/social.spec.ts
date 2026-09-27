import { describe, expect, it } from "vitest";

import { isWebLink, socialHandle } from "./social";

describe("socialHandle", () => {
  it("shortens a profile URL to its host and path", () => {
    expect(socialHandle("https://github.com/alirezarastineh")).toBe("github.com/alirezarastineh");
    expect(socialHandle("https://www.linkedin.com/in/alirezarastineh/")).toBe(
      "linkedin.com/in/alirezarastineh",
    );
    expect(socialHandle("https://alirezarastineh.me")).toBe("alirezarastineh.me");
  });

  it("gives a mail link's address without its query", () => {
    expect(socialHandle("mailto:hi@example.com?subject=Hello")).toBe("hi@example.com");
  });

  it("leaves anything else as it was", () => {
    expect(socialHandle("tel:+4930123")).toBe("tel:+4930123");
    expect(socialHandle("not a url")).toBe("not a url");
  });
});

describe("isWebLink", () => {
  it("is true for http(s) only", () => {
    expect(isWebLink("https://x.com/a")).toBe(true);
    expect(isWebLink("HTTP://x.com")).toBe(true);
    expect(isWebLink("mailto:a@b.c")).toBe(false);
  });
});
