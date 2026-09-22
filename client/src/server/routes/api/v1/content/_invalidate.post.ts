import { createHash, timingSafeEqual } from "node:crypto";
import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";

import { invalidate } from "./[locale].get";

/**
 * Constant-time, so response timing cannot be used to recover the token byte
 * by byte. Both sides are hashed first because timingSafeEqual needs equal
 * lengths, and comparing lengths directly would leak the token's length.
 */
function sameToken(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

/**
 * Called by the API immediately after a publish, over the compose `internal`
 * network, so an edit goes live in ~0s instead of waiting out the 60s TTL.
 *
 * A failure here is not fatal for publishing — the TTL is the floor.
 */
export default defineEventHandler(async (event) => {
  const expected = process.env["CONTENT_INVALIDATE_TOKEN"];

  // Without a configured token the endpoint stays closed rather than open.
  if (!expected) {
    setResponseStatus(event, 503);
    return { error: "invalidation_disabled" };
  }

  const provided = getHeader(event, "authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided || !sameToken(provided, expected)) {
    setResponseStatus(event, 401);
    return { error: "unauthorized" };
  }

  const body = (await readBody(event).catch(() => null)) as { locale?: string } | null;
  const locale = body?.locale;

  if (locale === "en" || locale === "de") {
    invalidate(locale);
    return { ok: true, invalidated: [locale] };
  }

  invalidate();
  return { ok: true, invalidated: ["en", "de"] };
});
