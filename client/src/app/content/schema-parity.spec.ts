import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const server = (path: string) => resolve(here, "../../../../server/src", path);

const PAIRS = [
  {
    name: "content schema",
    canonical: server("content/schema.ts"),
    mirror: resolve(here, "schema.ts"),
    marker: "// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───",
  },
  {
    name: "admin input schema",
    canonical: server("content/admin-schema.ts"),
    mirror: resolve(here, "../admin/admin-schema.ts"),
    marker:
      "// ─── SHARED ADMIN INPUT SCHEMA — everything below this line is mirrored verbatim ───",
  },
];

function sharedBody(path: string, marker: string): string {
  const source = readFileSync(path, "utf8");
  const at = source.indexOf(marker);
  expect(at, `marker missing in ${path}`).toBeGreaterThan(-1);
  // Normalise line endings so a git autocrlf checkout cannot fail this.
  return source.slice(at).replace(/\r\n/g, "\n");
}

/**
 * `client/` and `server/` are separate pnpm projects with separate Docker build
 * contexts, so the shared schemas are duplicated rather than imported. This
 * spec is the entire safety net for that decision: if the copies drift, the
 * server would validate one shape while the client is typed against another.
 *
 * Fix a failure with `pnpm -C server content:sync` — never by editing the
 * mirrored copy.
 */
describe("schema parity", () => {
  for (const pair of PAIRS) {
    it(`keeps the client's ${pair.name} identical to the server canonical`, () => {
      expect(sharedBody(pair.mirror, pair.marker)).toBe(sharedBody(pair.canonical, pair.marker));
    });
  }
});
