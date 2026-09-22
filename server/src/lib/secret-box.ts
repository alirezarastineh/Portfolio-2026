import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets that must stay recoverable — TOTP seeds — unlike
 * passwords and recovery codes, which are only ever hashed. A database dump on
 * its own is then no longer enough to mint second-factor codes.
 *
 * Stored as `v1:<iv>:<ciphertext>:<tag>` (base64url). A value without the
 * prefix is a plaintext secret written before encryption existed: it is read
 * as-is and re-sealed the next time the account verifies a code.
 *
 * With TOTP_ENC_KEY unset, `seal` leaves values in plaintext, so a deploy that
 * has not configured the key behaves exactly as before rather than failing.
 */
const PREFIX = "v1:";
const KEY_BYTES = 32;

function encryptionKey(): Buffer | null {
  const raw = process.env.TOTP_ENC_KEY?.trim();
  if (!raw) return null;

  // Either `openssl rand -hex 32` (64 hex chars) or 32 bytes in base64. Hex is
  // checked first: 64 hex chars are also valid base64, but would decode to 48
  // bytes and be rejected.
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOTP_ENC_KEY must be ${KEY_BYTES} bytes: 64 hex chars or base64`);
  }
  return key;
}

export function isSealed(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function seal(plaintext: string): string {
  const key = encryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + [iv, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(":");
}

export function unseal(stored: string): string {
  if (!isSealed(stored)) return stored;

  const key = encryptionKey();
  if (!key) throw new Error("TOTP secret is encrypted but TOTP_ENC_KEY is not set");

  const [iv, ciphertext, tag] = stored
    .slice(PREFIX.length)
    .split(":")
    .map((part) => Buffer.from(part, "base64url"));
  if (!iv || !ciphertext || !tag) throw new Error("malformed sealed secret");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** A legacy plaintext value that should be rewritten now that a key exists. */
export function needsReseal(stored: string): boolean {
  return !isSealed(stored) && encryptionKey() !== null;
}
