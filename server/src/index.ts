import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { config as loadEnv } from "dotenv";
import { Hono } from "hono";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.local";
if (existsSync(envFile)) {
  loadEnv({ path: envFile });
}

const app = new Hono();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOST ?? "0.0.0.0";

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

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
