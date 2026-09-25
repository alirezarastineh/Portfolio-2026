import { Hono } from "hono";
import { cors } from "hono/cors";

import { setAskDeps, type AskDeps } from "./ask/deps.js";
import { createAskRouter } from "./ask/route.js";
import { adminOrigins } from "./auth/middleware.js";
import { getPool } from "./db/client.js";
import { onApiError } from "./lib/http-errors.js";
import { requestLog } from "./lib/request-log.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { contactRouter } from "./routes/contact.js";
import { contentV2Router } from "./routes/content.js";
import { mediaRouter } from "./routes/media.js";

/**
 * The HTTP app, free of boot side effects (env loading, migrations, listening)
 * so tests can drive it through `app.request()` against a test database.
 * Env is read when this is called, so load it first. `ask` swaps the
 * assistant's models and corpus (tests).
 */
export function createApp(options: { ask?: AskDeps } = {}): Hono {
  setAskDeps(options.ask ?? {});
  const app = new Hono();
  app.onError(onApiError);
  // Silent under test, where it would only bury the reporter's output.
  if (process.env.NODE_ENV !== "test") app.use("*", requestLog);

  const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  /**
   * Two CORS policies, deliberately separate.
   *
   * The credentialed one is mounted only on /auth and /admin and echoes an exact
   * allow-list — never "*", which browsers reject with credentials anyway. The
   * public one stays narrow: the content API is read-only and needs no cookies.
   */
  const credentialedCors = cors({
    origin: adminOrigins(),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-CSRF-Token"],
    maxAge: 600,
  });

  app.use("/auth/*", credentialedCors);
  app.use("/admin/*", credentialedCors);

  app.use(
    "*",
    cors({
      origin: corsOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      maxAge: 600,
    }),
  );

  // Includes the database: an API that is up but cannot reach Postgres serves
  // nothing useful, and the container healthcheck and uptime checks should see
  // that. Bounded, so a hung connection cannot hang the probe too.
  app.get("/health", async (c) => {
    try {
      await Promise.race([
        getPool().query("select 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000).unref()),
      ]);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "degraded", db: "unreachable" }, 503);
    }
  });

  app.route("/contact", contactRouter);
  app.route("/v1/ask", createAskRouter());
  app.route("/v2/content", contentV2Router);
  // Public: uploaded images must be fetchable by anyone viewing the portfolio.
  app.route("/media", mediaRouter);
  app.route("/auth", authRouter);
  app.route("/admin", adminRouter);

  return app;
}
