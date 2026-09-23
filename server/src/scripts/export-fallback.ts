import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";

import { LOCALES, type Doc, type Locale } from "../content/schema.js";
import { payloadVersion, upcast, upcastDocs } from "../content/upcast.js";
import { closeDb, getDb } from "../db/client.js";
import { contentPointers, contentVersionDocs, contentVersions } from "../db/schema.js";
import { loadEnvFiles } from "../lib/env.js";

/**
 * `pnpm content:fallback` — regenerates the content the site's SSR server
 * shows when the API is unreachable:
 *
 *   client/src/app/content/fallback.{en,de}.json       the core payload
 *   client/src/app/content/fallback-docs.{en,de}.json  its docs, by key
 *
 * From the live publication (read-only: it only SELECTs, so pointing it at the
 * production tunnel is safe). `--from-files` instead upcasts the fallback files
 * already in the client — how the first v2 fallback was made.
 */

const here = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(here, "../../../client/src/app/content");

function write(name: string, value: unknown): void {
  const path = resolve(CONTENT_DIR, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`[fallback] wrote ${path}`);
}

async function fromDatabase(): Promise<Map<Locale, { core: unknown; docs: Map<string, Doc> }>> {
  const db = getDb();
  const rows = await db
    .select({
      locale: contentPointers.locale,
      versionId: contentVersions.id,
      payload: contentVersions.payload,
      createdAt: contentVersions.createdAt,
    })
    .from(contentPointers)
    .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId));
  const docRows = rows.length
    ? await db
        .select({
          versionId: contentVersionDocs.versionId,
          key: contentVersionDocs.key,
          payload: contentVersionDocs.payload,
        })
        .from(contentVersionDocs)
        .where(
          inArray(
            contentVersionDocs.versionId,
            rows.map((r) => r.versionId),
          ),
        )
    : [];

  const out = new Map<Locale, { core: unknown; docs: Map<string, Doc> }>();
  for (const row of rows) {
    const result = upcast(row.payload, row.createdAt.toISOString());
    if (!result.ok) throw new Error(`live ${row.locale} v${row.versionId} does not validate`);
    const docs = await upcastDocs(
      payloadVersion(row.payload) ?? result.from,
      row.locale,
      docRows.filter((d) => d.versionId === row.versionId),
    );
    out.set(row.locale, { core: result.content, docs });
  }
  return out;
}

async function fromFiles(): Promise<Map<Locale, { core: unknown; docs: Map<string, Doc> }>> {
  const out = new Map<Locale, { core: unknown; docs: Map<string, Doc> }>();
  for (const locale of LOCALES) {
    const payload = JSON.parse(
      readFileSync(resolve(CONTENT_DIR, `fallback.${locale}.json`), "utf8"),
    ) as unknown;
    const result = upcast(payload, new Date("2026-09-22T00:00:00.000Z").toISOString());
    if (!result.ok)
      throw new Error(
        `fallback.${locale}.json does not validate: ${JSON.stringify(result.issues)}`,
      );
    const docs = await upcastDocs(payloadVersion(payload) ?? result.from, locale, []);
    out.set(locale, { core: result.content, docs });
  }
  return out;
}

loadEnvFiles();
try {
  const content = process.argv.includes("--from-files") ? await fromFiles() : await fromDatabase();
  for (const locale of LOCALES) {
    const entry = content.get(locale);
    if (!entry) throw new Error(`nothing is published for "${locale}"`);
    write(`fallback.${locale}.json`, entry.core);
    write(
      `fallback-docs.${locale}.json`,
      Object.fromEntries([...entry.docs].sort(([a], [b]) => a.localeCompare(b))),
    );
  }
} catch (error) {
  console.error("[fallback] failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
