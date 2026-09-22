import { randomInt } from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Portfolio Admin";
const PERIOD_SECONDS = 30;
/** ±1 step of 30s, which absorbs ordinary clock drift without widening much. */
const VALIDATION_WINDOW = 1;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function totpFor(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function totpUri(secret: string, label: string): string {
  return totpFor(secret, label).toString();
}

export async function totpQrSvg(secret: string, label: string): Promise<string> {
  // Rendered server-side so the admin UI needs no QR dependency of its own.
  return QRCode.toString(totpUri(secret, label), { type: "svg", margin: 1 });
}

/**
 * The absolute time step the code belongs to, or null when it matches none in
 * the window. Callers that persist the last accepted step can then refuse a
 * second use of the same code inside its 90s validity window.
 */
export function matchTotpStep(secret: string, token: string, now = Date.now()): number | null {
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;

  // `validate` returns the time-step delta, or null when no step matches.
  const totp = totpFor(secret, "admin");
  const delta = totp.validate({ token: cleaned, timestamp: now, window: VALIDATION_WINDOW });
  return delta === null ? null : totp.counter({ timestamp: now }) + delta;
}

export function verifyTotp(secret: string, token: string): boolean {
  return matchTotpStep(secret, token) !== null;
}

/** 10 single-use codes, shown once at enrolment and stored only as hashes. */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    let code = "";
    for (let c = 0; c < 10; c++) {
      if (c === 5) code += "-";
      code += alphabet[randomInt(alphabet.length)];
    }
    codes.push(code);
  }
  return codes;
}

/**
 * Hashes were taken over the displayed `XXXXX-XXXXX` form, so a code typed
 * without the hyphen (or with spaces) is put back into that shape first —
 * otherwise a correct code would fail on formatting alone.
 */
export function normalizeRecoveryCode(code: string): string {
  const compact = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
}

/** Lets the TOTP step skip ten argon2 verifies for input that is plainly a 6-digit code. */
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(normalizeRecoveryCode(code));
}
