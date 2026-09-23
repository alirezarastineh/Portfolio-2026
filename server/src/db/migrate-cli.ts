import { closeDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { backfillContentV2 } from "../content/backfill.js";
import { loadEnvFiles } from "../lib/env.js";

/**
 * Standalone entry point for `pnpm db:migrate`. The server also migrates at
 * boot, so this exists for applying a schema change without starting the API —
 * e.g. through the dev SSH tunnel. Runs the same content backfill the boot does.
 */
loadEnvFiles();

try {
  if (await runMigrations()) {
    const report = await backfillContentV2();
    console.log(
      `[db] content v2 backfill: ${report.ui} ui document(s), ${report.legal} legal document(s)`,
    );
  }
} catch (error) {
  console.error("[db] migration failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
