import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * `Algorithm` is an ambient const enum, which `verbatimModuleSyntax` forbids
 * importing as a value — so the member is spelled out. 2 is Argon2id, and is
 * also the library default; passing it keeps the choice explicit in the code.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * OWASP 2024 baseline for argon2id: 19 MiB, 2 iterations, 1 lane. Comfortable
 * inside the container's memory budget while staying expensive to attack.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * Verified against a throwaway password at module load. Used to burn the same
 * CPU time when an email does not exist, so response timing cannot be used to
 * enumerate accounts.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$J4moa2Ny5/CLsnJb1RTvSLmBLnVEVnPuWJbfN3OZ0Ic";

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(encoded: string, plain: string): Promise<boolean> {
  try {
    return await verify(encoded, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash.
    return false;
  }
}

/** Equalises timing on the unknown-email path. The result is discarded. */
export async function burnVerify(plain: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plain);
  } catch {
    // Expected to fail; only the elapsed time matters.
  }
}
