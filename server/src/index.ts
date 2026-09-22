import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { startSessionPruning } from "./auth/session.js";
import { closeDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { startAuthAttemptPruning } from "./lib/auth-rate-limit.js";
import { loadEnvFiles } from "./lib/env.js";
import { captureError, flushSentry, initSentry } from "./lib/sentry.js";

loadEnvFiles();
// Before anything else runs, so a failure during boot is reported too.
await initSentry();

const app = createApp();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "0.0.0.0";

// Before serve(), so the container healthcheck gates traffic until the schema
// is current. A failure here should stop the boot rather than serve a half-
// migrated database.
try {
  await runMigrations();
} catch (error) {
  console.error("[db] migration failed", error);
  captureError(error, { phase: "migrations" });
  await flushSentry();
  process.exit(1);
}

startAuthAttemptPruning();
startSessionPruning();

if (process.env.NODE_ENV === "production" && !process.env.TOTP_ENC_KEY?.trim()) {
  console.warn("[auth] TOTP_ENC_KEY is not set — TOTP secrets are stored unencrypted");
}

const server = serve(
  {
    fetch: app.fetch,
    hostname,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

/**
 * On a deploy Docker sends SIGTERM, then SIGKILLs after its grace period. Stop
 * accepting connections, let in-flight requests (a publish, an upload) finish,
 * then close the pool so Postgres sees a clean disconnect rather than a reset.
 */
const SHUTDOWN_TIMEOUT_MS = 8_000;
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[api] ${signal} received, draining`);

  // Inside Docker's default 10s grace period, so we exit on our own terms.
  setTimeout(() => {
    console.error("[api] shutdown timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close((error) => {
    void Promise.allSettled([closeDb(), flushSentry()])
      .then((results) => {
        for (const result of results) {
          if (result.status === "rejected") console.error("[api] shutdown step failed", result.reason);
        }
      })
      .finally(() => process.exit(error ? 1 : 0));
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
