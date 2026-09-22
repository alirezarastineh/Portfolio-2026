import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isSealed, needsReseal, seal, unseal } from "./secret-box.js";

const SECRET = "JBSWY3DPEHPK3PXP";

function useKey(key = randomBytes(32).toString("base64")): string {
  vi.stubEnv("TOTP_ENC_KEY", key);
  return key;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secret box", () => {
  it("round-trips a secret through seal and unseal", () => {
    useKey();
    const sealed = seal(SECRET);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain(SECRET);
    expect(unseal(sealed)).toBe(SECRET);
  });

  /** A fresh IV per seal, so equal secrets never produce equal ciphertexts. */
  it("never produces the same ciphertext twice", () => {
    useKey();
    expect(seal(SECRET)).not.toBe(seal(SECRET));
  });

  it("rejects ciphertext that was tampered with", () => {
    useKey();
    const sealed = seal(SECRET);
    const [prefix, iv, ciphertext, tag] = sealed.split(":");
    const flipped = Buffer.from(ciphertext!, "base64url");
    flipped[0]! ^= 0xff;
    expect(() => unseal([prefix, iv, flipped.toString("base64url"), tag].join(":"))).toThrow();
  });

  it("rejects a value sealed under a different key", () => {
    useKey();
    const sealed = seal(SECRET);
    useKey();
    expect(() => unseal(sealed)).toThrow();
  });

  /** Unconfigured deploys must keep working exactly as before. */
  it("leaves values in plaintext when no key is configured", () => {
    vi.stubEnv("TOTP_ENC_KEY", "");
    expect(seal(SECRET)).toBe(SECRET);
    expect(unseal(SECRET)).toBe(SECRET);
    expect(needsReseal(SECRET)).toBe(false);
  });

  it("reads legacy plaintext and flags it for resealing once a key exists", () => {
    useKey();
    expect(unseal(SECRET)).toBe(SECRET);
    expect(needsReseal(SECRET)).toBe(true);
    expect(needsReseal(seal(SECRET))).toBe(false);
  });

  it("refuses to unseal without the key instead of returning ciphertext", () => {
    useKey();
    const sealed = seal(SECRET);
    vi.stubEnv("TOTP_ENC_KEY", "");
    expect(() => unseal(sealed)).toThrow(/TOTP_ENC_KEY/);
  });

  it("rejects a key of the wrong length", () => {
    useKey(randomBytes(16).toString("base64"));
    expect(() => seal(SECRET)).toThrow(/32 bytes/);
  });

  /** `openssl rand -hex 32` is the natural way to make one, as for the other secrets. */
  it("accepts a 64-character hex key as well as base64", () => {
    const bytes = randomBytes(32);
    useKey(bytes.toString("hex"));
    const sealed = seal(SECRET);
    // The same 32 bytes given as base64 must open it: both spellings are one key.
    useKey(bytes.toString("base64"));
    expect(unseal(sealed)).toBe(SECRET);
  });
});
