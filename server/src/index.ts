import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { config as loadEnv } from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { contactRouter } from "./routes/contact.js";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
if (existsSync(envFile)) {
  loadEnv({ path: envFile });
}

const app = new Hono();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "0.0.0.0";

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 600,
  }),
);

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.route("/contact", contactRouter);

serve(
  {
    fetch: app.fetch,
    hostname,
    port,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
