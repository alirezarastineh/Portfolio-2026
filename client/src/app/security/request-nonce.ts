/**
 * Where the CSP nonce travels from Nitro to Angular: the middleware
 * (`src/server/middleware/csp.ts`) stores it on the Node request, and the
 * server app config reads it back through Analog's `REQUEST` token.
 * Framework-free, so the Nitro bundle can import it.
 */

const NONCE_KEY = "cspNonce";

type NonceCarrier = Record<typeof NONCE_KEY, unknown>;

export function writeRequestNonce(req: object, nonce: string): void {
  (req as NonceCarrier)[NONCE_KEY] = nonce;
}

/** The request's nonce, or null when none was issued (dev, `CSP_MODE=off`, no request). */
export function readRequestNonce(req: object | null | undefined): string | null {
  const nonce = (req as Partial<NonceCarrier> | null | undefined)?.[NONCE_KEY];
  return typeof nonce === "string" && nonce.length > 0 ? nonce : null;
}
