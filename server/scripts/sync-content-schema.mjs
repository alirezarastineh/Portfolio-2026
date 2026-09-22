// Mirrors the canonical content schema into the client project.
// The two projects have separate Docker build contexts and no pnpm workspace,
// so the schema is duplicated rather than imported; `schema-parity.spec.ts`
// fails if the copies drift.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(here, "../src/content/schema.ts");
const MIRROR = resolve(here, "../../client/src/app/content/schema.ts");

export const MARKER =
  "// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───";

const MIRROR_HEADER = `/**
 * MIRRORED COPY — do not edit.
 *
 * Generated from \`server/src/content/schema.ts\` by \`pnpm content:sync\`.
 * Edit the canonical file there and re-run the sync; \`schema-parity.spec.ts\`
 * fails the test suite if these two drift apart.
 */`;

const canonical = readFileSync(CANONICAL, "utf8");
const markerAt = canonical.indexOf(MARKER);

if (markerAt === -1) {
  console.error(`[sync] marker not found in ${CANONICAL}`);
  process.exit(1);
}

const body = canonical.slice(markerAt);
mkdirSync(dirname(MIRROR), { recursive: true });
writeFileSync(MIRROR, `${MIRROR_HEADER}\n${body}`, "utf8");

console.log(`[sync] wrote ${MIRROR} (${body.length} shared bytes)`);
