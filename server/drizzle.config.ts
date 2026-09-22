import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Kept self-contained rather than importing src/lib/env.ts: drizzle-kit loads
// this file through its own bundler, so fewer moving parts is safer here.
//
// .env.local is deliberately not loaded: in dev it can point at the production
// tunnel, and `db:push` would then rewrite the live schema outside the
// migration journal. Commands that need a database take DATABASE_URL from the
// shell instead (PowerShell: `$env:DATABASE_URL = "postgresql://…"`).
for (const file of [".env", resolve(process.cwd(), "..", ".env")]) {
  if (existsSync(file)) {
    loadEnv({ path: file });
  }
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
