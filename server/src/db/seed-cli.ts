import { closeDb } from "./client.js";
import { seed } from "./seed.js";
import { loadEnvFiles } from "../lib/env.js";

/** Entry point for `pnpm db:seed`. Safe to re-run: the seed is idempotent. */
loadEnvFiles();

try {
  await seed();
  console.log("[seed] done");
} catch (error) {
  console.error("[seed] failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
