import { and, eq } from "drizzle-orm";

import { plainTextToRichText } from "../content/sanitize.js";
import { loadEnvFiles } from "../lib/env.js";
import { closeDb, getDb } from "./client.js";
import { projectTranslations } from "./schema.js";

/**
 * One-off: wraps the three project fields that became rich text in paragraphs.
 *
 * Idempotent — a value that already starts with a block tag is passed through
 * the sanitizer instead of being wrapped again, so re-running is harmless.
 *
 *   pnpm db:migrate-richtext
 */
loadEnvFiles();

const FIELDS = ["problem", "aiArchitecture", "fullStackInfra"] as const;

try {
  const db = getDb();
  const rows = await db.select().from(projectTranslations);
  const updates = rows.flatMap((row) => {
    const next: Partial<Record<(typeof FIELDS)[number], string>> = {};

    for (const field of FIELDS) {
      const converted = plainTextToRichText(row[field]);
      if (converted !== row[field]) {
        next[field] = converted;
      }
    }

    if (Object.keys(next).length === 0) {
      return [];
    }

    // Keyed on the full (project, locale) primary key: matching the project
    // alone wrote this row's converted text over every other locale too.
    return [{ projectId: row.projectId, locale: row.locale, next }];
  });

  await updates.reduce(
    (chain, { projectId, locale, next }) =>
      chain.then(async () => {
        await db
          .update(projectTranslations)
          .set(next)
          .where(
            and(
              eq(projectTranslations.projectId, projectId),
              eq(projectTranslations.locale, locale),
            ),
          );
        console.log(`[richtext] converted ${projectId} (${locale})`);
      }),
    Promise.resolve(),
  );
  const changed = updates.length;

  console.log(
    changed === 0
      ? "[richtext] nothing to convert — already rich text"
      : `[richtext] converted ${changed} translation row(s). Publish to make it live.`,
  );
} catch (error) {
  console.error("[richtext] failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
