/**
 * Regenerates the bundled disaster fallbacks from the live content API.
 *
 * The database is the source of truth now, so the fallbacks are refreshed from
 * it rather than from the old hard-coded TypeScript (which was removed once the
 * public read path was cut over).
 *
 * These files are a **disaster fallback, not a live mirror** — they are what
 * the site renders when the API is unreachable. They go stale by design; refresh
 * them when the content schema changes shape, or when the current content has
 * drifted far enough that serving the old copy during an outage would be worse
 * than serving nothing recognisable.
 *
 * Run:  pnpm fallback:refresh            (defaults to VITE_API_BASE_URL)
 *       pnpm fallback:refresh --api http://127.0.0.1:3000
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appContentSchema, LOCALES } from "../src/app/content/schema";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, "../src/app/content");

function resolveApiBase(): string {
  const flag = process.argv.indexOf("--api");
  const fromFlag = flag !== -1 ? process.argv[flag + 1] : undefined;
  let base = fromFlag ?? process.env["VITE_API_BASE_URL"] ?? "https://api.alirezarastineh.me";
  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }
  return base;
}

const api = resolveApiBase();
console.log(`[fallback] source: ${api}`);

for (const locale of LOCALES) {
  const response = await fetch(`${api}/v1/content/${locale}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    console.error(`[fallback] ${locale}: HTTP ${response.status}`);
    process.exitCode = 1;
    continue;
  }

  // Never write an unvalidated payload — a bad fallback only surfaces during
  // an outage, which is the worst possible time to discover it.
  const parsed = appContentSchema.safeParse(await response.json());
  if (!parsed.success) {
    console.error(`[fallback] ${locale}: invalid payload`, parsed.error.issues);
    process.exitCode = 1;
    continue;
  }

  const path = resolve(OUT_DIR, `fallback.${locale}.json`);
  writeFileSync(path, `${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
  console.log(`[fallback] wrote ${path}`);
}
