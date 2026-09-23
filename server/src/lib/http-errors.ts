import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";

import { captureError } from "./sentry.js";

/**
 * Postgres SQLSTATE of an error, looking through wrappers: Drizzle rethrows
 * driver errors as `DrizzleQueryError` with the original on `cause`.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 22P02 invalid_text_representation — e.g. "abc" where a uuid column is compared. */
const INVALID_INPUT_SQLSTATE = "22P02";

/**
 * Without this, a malformed `:id` reached Postgres and came back as a bare 500,
 * and any other throw produced Hono's plain-text page. Callers get JSON in the
 * same `{ error }` shape as every deliberate response; details stay in the log.
 */
export const onApiError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();

  if (pgErrorCode(error) === INVALID_INPUT_SQLSTATE) {
    return c.json({ error: "invalid_id" }, 400);
  }

  console.error(`[api] unhandled error on ${c.req.method} ${c.req.path}`, error);
  captureError(error, { method: c.req.method, path: routePath(c) || c.req.path });
  return c.json({ error: "internal_error" }, 500);
};
