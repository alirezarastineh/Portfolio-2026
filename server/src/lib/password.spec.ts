import { describe, expect, it } from "vitest";

import { burnVerify, hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("produces an argon2id hash with the OWASP parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword(hash, "s3cret-passphrase")).toBe(true);
    expect(await verifyPassword(hash, "s3cret-passphras")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts, so the same password never yields the same hash", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same")).toBe(true);
    expect(await verifyPassword(b, "same")).toBe(true);
  });

  /** A corrupt stored hash must read as "wrong password", never crash a login. */
  it("treats a malformed stored hash as a failed verification", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });

  /**
   * The unknown-email path calls this so the response takes comparable time to
   * a real verification. If it ever became a no-op, login timing would leak
   * which email addresses exist.
   */
  it("burnVerify resolves and costs real work", async () => {
    const started = performance.now();
    await burnVerify("whatever");
    expect(performance.now() - started).toBeGreaterThan(1);
  });
});
