import { describe, expect, it } from "vitest";

import {
  backoffDelayMs,
  emailBucket,
  ipBucket,
  ipEmailBucket,
  totpBucket,
} from "./auth-rate-limit.js";

/**
 * Only the pure parts are covered here. The query paths are exercised against a
 * real database by the auth verification run documented in DEPLOYMENT.md —
 * stubbing Drizzle's builder chain would test the mock, not the limiter.
 */
describe("auth rate limit buckets", () => {
  it("namespaces IP and email buckets so they cannot collide", () => {
    expect(ipBucket("1.2.3.4")).toBe("ip:1.2.3.4");
    expect(emailBucket("a@b.c")).toBe("email:a@b.c");
    expect(ipBucket("x")).not.toBe(emailBucket("x"));
  });

  /** Otherwise case or padding would create a separate bucket per spelling. */
  it("normalizes email so casing cannot dodge the limit", () => {
    expect(emailBucket("  Admin@Example.COM ")).toBe("email:admin@example.com");
    expect(ipEmailBucket("1.2.3.4", " Admin@Example.COM")).toBe(
      "ip-email:1.2.3.4|admin@example.com",
    );
  });

  it("keeps the pair and TOTP buckets apart from the single-key ones", () => {
    const buckets = [
      ipBucket("x"),
      emailBucket("x"),
      ipEmailBucket("x", "x"),
      totpBucket("x"),
    ];
    expect(new Set(buckets).size).toBe(buckets.length);
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially with the failure count", () => {
    expect(backoffDelayMs(0)).toBe(100);
    expect(backoffDelayMs(1)).toBe(200);
    expect(backoffDelayMs(2)).toBe(400);
    expect(backoffDelayMs(3)).toBe(800);
  });

  /** Capped, so a long-running attack cannot pin a request handler open. */
  it("caps at two seconds", () => {
    expect(backoffDelayMs(10)).toBe(2000);
    expect(backoffDelayMs(1000)).toBe(2000);
  });
});
