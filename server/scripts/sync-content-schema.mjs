// Mirrors the shared schemas into the client project.
// The two projects have separate Docker build contexts and no pnpm workspace,
// so the schemas are duplicated rather than imported; `schema-parity.spec.ts`
// fails if the copies drift.
//
// - src/content/schema.ts        → client/src/app/content/schema.ts (the published content)
// - src/content/admin-schema.ts  → client/src/app/admin/admin-schema.ts (what the admin API accepts)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const CONTENT_MARKER =
  "// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───";
export const ADMIN_MARKER =
  "// ─── SHARED ADMIN INPUT SCHEMA — everything below this line is mirrored verbatim ───";

const header = (canonical) => `/**
 * MIRRORED COPY — do not edit.
 *
 * Generated from \`server/${canonical}\` by \`pnpm content:sync\`.
 * Edit the canonical file there and re-run the sync; \`schema-parity.spec.ts\`
 * fails the test suite if these two drift apart.
 */`;

const MIRRORS = [
  {
    canonical: "src/content/schema.ts",
    mirror: "../client/src/app/content/schema.ts",
    marker: CONTENT_MARKER,
    // Everything the body needs is imported below the marker.
    rewriteImports: null,
  },
  {
    canonical: "src/content/admin-schema.ts",
    mirror: "../client/src/app/admin/admin-schema.ts",
    marker: ADMIN_MARKER,
    // The imports sit above the marker; the client resolves them elsewhere.
    rewriteImports: (block) => block.replaceAll('"./schema.js"', '"../content/schema"'),
  },
];

let failed = false;
for (const { canonical, mirror, marker, rewriteImports } of MIRRORS) {
  const source = readFileSync(resolve(here, "..", canonical), "utf8");
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) {
    console.error(`[sync] marker not found in ${canonical}`);
    failed = true;
    continue;
  }

  const body = source.slice(markerAt);
  let imports = "";
  if (rewriteImports) {
    const commentEnd = source.indexOf("*/") + 2;
    imports = `${rewriteImports(source.slice(commentEnd, markerAt).trim())}\n`;
  }

  const target = resolve(here, "..", mirror);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${header(canonical)}\n${imports}${body}`, "utf8");
  console.log(`[sync] wrote ${mirror} (${body.length} shared bytes)`);
}

if (failed) process.exit(1);
