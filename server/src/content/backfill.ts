import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { contentDocuments } from "../db/schema.js";
import type { DbExecutor } from "./build.js";
import { LEGAL_DEFAULTS } from "./legal-defaults.js";
import { canonicalJson } from "./publish.js";
import { LOCALES, legalDocSchema } from "./schema.js";
import { withUiDefaults } from "./ui-defaults.js";

export interface BackfillReport {
  /** `ui` documents that gained v2 keys. */
  ui: number;
  /** Legal documents created from the bundled draft. */
  legal: number;
}

/**
 * Brings the draft documents up to content model v2. Idempotent, and runs at
 * boot right after the migrations (and in the seed):
 *
 * - each `ui` document gains the keys v2 added, with their default copy;
 *   anything already there — every edit made in the admin — is kept as-is;
 * - `imprint` and `privacy` are created from the bundled draft if missing.
 *
 * Nothing is touched before the seed has created the `ui` documents.
 */
export async function backfillContentV2(db: DbExecutor = getDb()): Promise<BackfillReport> {
  const report: BackfillReport = { ui: 0, legal: 0 };

  for (const locale of LOCALES) {
    const isUi = and(eq(contentDocuments.section, "ui"), eq(contentDocuments.locale, locale));
    const [ui] = await db
      .select({ data: contentDocuments.data })
      .from(contentDocuments)
      .where(isUi)
      .limit(1);
    if (!ui) continue;

    const filled = withUiDefaults(ui.data, locale);
    if (canonicalJson(filled) !== canonicalJson(ui.data)) {
      // updated_at stays: this is not an edit, and it is the editors' token
      // for detecting a save made elsewhere.
      await db.update(contentDocuments).set({ data: filled }).where(isUi);
      report.ui++;
    }

    for (const doc of legalDocSchema.options) {
      const inserted = await db
        .insert(contentDocuments)
        .values({ section: doc, locale, data: LEGAL_DEFAULTS[locale][doc] })
        .onConflictDoNothing()
        .returning({ section: contentDocuments.section });
      report.legal += inserted.length;
    }
  }

  return report;
}
