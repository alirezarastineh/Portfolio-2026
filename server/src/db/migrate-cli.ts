import { closeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { loadEnvFiles } from "../lib/env.js";

/**
 * Standalone entry point for `pnpm db:migrate`. The server also migrates at
 * boot, so this exists for applying a schema change without starting the API —
 * e.g. through the dev SSH tunnel.
 */
loadEnvFiles();

try {
  await runMigrations();
} catch (error) {
  console.error("[db] migration failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
