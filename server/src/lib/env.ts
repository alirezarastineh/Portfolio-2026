import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/**
 * Cascading env load, overlaying each file that exists. Extracted from
 * `index.ts` so the seed and admin-bootstrap scripts resolve DATABASE_URL the
 * same way the server does.
 */
export function loadEnvFiles(): void {
  const isProd = process.env.NODE_ENV === "production";
  const envFiles = [
    isProd ? ".env.production" : ".env.local",
    ".env",
    resolve(process.cwd(), "..", isProd ? ".env.production" : ".env.local"),
    resolve(process.cwd(), "..", ".env"),
  ];

  for (const file of envFiles) {
    if (existsSync(file)) {
      loadEnv({ path: file });
    }
  }
}
