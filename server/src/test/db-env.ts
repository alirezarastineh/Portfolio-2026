import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, inject } from "vitest";

import { closeDb } from "../db/client.js";
import { ADMIN_ORIGIN } from "./constants.js";
import { assertTestDatabase } from "./guard.js";

// Set before any route module reads them. Env is the only config these read.
const databaseUrl = inject("databaseUrl");
assertTestDatabase(databaseUrl);

const mediaRoot = mkdtempSync(join(tmpdir(), "portfolio-media-"));

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = "test";
process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
process.env.CORS_ORIGIN = ADMIN_ORIGIN;
process.env.MEDIA_ROOT = mediaRoot;
process.env.MEDIA_PUBLIC_BASE_URL = "http://api.test";
// Publishing must never try to reach a real SSR container.
delete process.env.CONTENT_INVALIDATE_URL;
delete process.env.CONTENT_INVALIDATE_TOKEN;
delete process.env.RESEND_API_KEY;
delete process.env.TOTP_ENC_KEY;

afterAll(async () => {
  await closeDb();
  rmSync(mediaRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
