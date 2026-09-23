import { loadEnvFiles } from "../lib/env.js";
import { reprocessMedia } from "../lib/media-reprocess.js";
import { closeDb } from "./client.js";

/**
 * One-off, after deploying the media pipeline: strips EXIF from images that
 * were uploaded before it and generates their variants and blur placeholders.
 * Idempotent, so it is safe to re-run.
 *
 * Runs where the media files are — in production, inside the api container:
 *
 *   docker compose exec api node dist/src/db/media-reprocess-cli.js [--dry-run]
 *
 * Locally: pnpm media:reprocess [--dry-run]
 */
loadEnvFiles();

const dryRun = process.argv.includes("--dry-run");

try {
  const { processed, missing, failed } = await reprocessMedia({ dryRun });

  for (const name of processed)
    console.log(`[media] ${dryRun ? "would process" : "processed"} ${name}`);
  for (const name of missing) console.warn(`[media] file missing on disk: ${name}`);
  for (const { filename, error } of failed) console.error(`[media] failed ${filename}: ${error}`);

  console.log(
    `[media] ${processed.length} ${dryRun ? "to process" : "processed"}, ${missing.length} missing, ${failed.length} failed`,
  );
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error("[media] reprocess failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
