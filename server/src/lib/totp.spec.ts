import * as OTPAuth from "otpauth";
import { describe, expect, it } from "vitest";

import {
  generateRecoveryCodes,
  generateTotpSecret,
  looksLikeRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from "./totp.js";

function currentCode(secret: string, offsetSeconds = 0, base = Date.now()): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate({ timestamp: base + offsetSeconds * 1000 });
}

describe("TOTP", () => {
  it("accepts a code generated from the same secret", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, currentCode(secret))).toBe(true);
  });

  it("rejects a code from a different secret", () => {
    expect(verifyTotp(generateTotpSecret(), currentCode(generateTotpSecret()))).toBe(false);
  });

  it("tolerates one step of clock drift in each direction", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, currentCode(secret, -30))).toBe(true);
    expect(verifyTotp(secret, currentCode(secret, 30))).toBe(true);
  });

  it("rejects a code well outside the window", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, currentCode(secret, -300))).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateTotpSecret();
    for (const bad of ["", "abc", "12345", "1234567", "!!!!!!", "abcdef"]) {
      expect(verifyTotp(secret, bad)).toBe(false);
    }
  });

  it("ignores whitespace, which authenticator apps often include", () => {
    const secret = generateTotpSecret();
    const code = currentCode(secret);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
  });

  /** Replay protection keys on this value, so it must be the step the code was minted for. */
  it("reports the absolute time step a code belongs to", () => {
    const secret = generateTotpSecret();
    // Fixed and mid-step, so no 30s boundary can fall between minting and checking.
    const now = 1_700_000_025_000;
    const step = Math.floor(now / 1000 / 30);
    expect(matchTotpStep(secret, currentCode(secret, 0, now), now)).toBe(step);
    expect(matchTotpStep(secret, currentCode(secret, -30, now), now)).toBe(step - 1);
    expect(matchTotpStep(secret, currentCode(generateTotpSecret(), 0, now), now)).toBeNull();
  });

  it("builds an otpauth URI an authenticator can import", () => {
    const secret = generateTotpSecret();
    const uri = totpUri(secret, "admin@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
  });
});

describe("recovery codes", () => {
  it("generates ten distinct codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  /** No I/O/0/1, so a handwritten code cannot be mistranscribed. */
  it("avoids visually ambiguous characters", () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  it("normalizes user-typed codes", () => {
    expect(normalizeRecoveryCode("  abcde-fghjk ")).toBe("ABCDE-FGHJK");
  });

  /** Stored hashes cover the hyphenated form, so these must land on it too. */
  it("restores the hyphen when a code is typed without it", () => {
    expect(normalizeRecoveryCode("abcdefghjk")).toBe("ABCDE-FGHJK");
    expect(normalizeRecoveryCode("ABCDE FGHJK")).toBe("ABCDE-FGHJK");
  });

  it("tells recovery codes apart from 6-digit TOTP codes", () => {
    expect(looksLikeRecoveryCode("abcde-fghjk")).toBe(true);
    expect(looksLikeRecoveryCode("ABCDEFGHJK")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("123 456")).toBe(false);
  });
});
