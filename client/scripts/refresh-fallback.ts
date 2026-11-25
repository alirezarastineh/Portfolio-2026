/**
 * Regenerates the bundled disaster fallbacks from the live content API, in
 * `src/server/fallback/`: the core (`fallback.{en,de}.json`) and every doc it
 * lists (`fallback-docs.{en,de}.json`: case studies, posts, legal pages). The
 * files of the same names in `src/app/content/` are the frozen seed content that
 * the unit tests, the e2e fixtures and the admin tools build on: never refresh
 * those.
 *
 * These files are a **disaster fallback, not a live mirror** — they are what
 * the site renders when the API is unreachable. They go stale by design; refresh
 * them when the content schema changes shape, or when the current content has
 * drifted far enough that serving the old copy during an outage would be worse
 * than serving nothing recognisable.
 *
 * Needs only the public API. `pnpm -C server content:fallback` does the same
 * from the database.
 *
 * Run:  pnpm fallback:refresh            (defaults to VITE_API_BASE_URL)
 *       pnpm fallback:refresh --api http://127.0.0.1:3000
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appContentSchema,
  docKey,
  docSchema,
  LOCALES,
  type AppContent,
  type Doc,
  type DocKind,
} from "../src/app/content/schema";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../src/server/fallback");

function resolveApiBase(): string {
  const flag = process.argv.indexOf("--api");
  const fromFlag = flag === -1 ? undefined : process.argv[flag + 1];
  let base = fromFlag ?? process.env["VITE_API_BASE_URL"] ?? "https://api.alirezarastineh.me";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

const api = resolveApiBase();
console.log(`[fallback] source: ${api}`);

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${api}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function write(name: string, value: unknown): void {
  const path = resolve(OUT_DIR, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`[fallback] wrote ${path}`);
}

/** Every doc the core points at: legal pages, case studies, posts. */
function docsOf(core: AppContent): [DocKind, string][] {
  return [
    ...core.legal.map((l): [DocKind, string] => ["legal", l.doc]),
    ...core.projects
      .filter((p) => p.hasCaseStudy)
      .map((p): [DocKind, string] => ["projects", p.slug]),
    ...core.posts.map((p): [DocKind, string] => ["posts", p.slug]),
  ];
}

async function refreshLocale(locale: (typeof LOCALES)[number]): Promise<void> {
  try {
    // Never write an unvalidated payload — a bad fallback only surfaces during
    // an outage, which is the worst possible time to discover it.
    const core = appContentSchema.parse(await getJson(`/v2/content/${locale}`));
    const entries = await Promise.all(
      docsOf(core).map(async ([kind, slug]): Promise<[string, Doc]> => {
        const doc = docSchema.parse(await getJson(`/v2/content/${locale}/${kind}/${slug}`));
        return [docKey(kind, slug), doc];
      }),
    );
    entries.sort(([a], [b]) => a.localeCompare(b));
    write(`fallback.${locale}.json`, core);
    write(`fallback-docs.${locale}.json`, Object.fromEntries(entries));
  } catch (error) {
    console.error(`[fallback] ${locale}:`, error);
    process.exitCode = 1;
  }
}

await Promise.all(LOCALES.map((locale) => refreshLocale(locale)));
