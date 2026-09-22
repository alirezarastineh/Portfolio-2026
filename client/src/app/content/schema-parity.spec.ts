import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const CANONICAL = resolve(here, "../../../../server/src/content/schema.ts");
const MIRROR = resolve(here, "schema.ts");

const MARKER =
  "// ─── SHARED CONTENT SCHEMA — everything below this line is mirrored verbatim ───";

function sharedBody(path: string): string {
  const source = readFileSync(path, "utf8");
  const at = source.indexOf(MARKER);
  expect(at, `marker missing in ${path}`).toBeGreaterThan(-1);
  // Normalise line endings so a git autocrlf checkout cannot fail this.
  return source.slice(at).replace(/\r\n/g, "\n");
}

/**
 * `client/` and `server/` are separate pnpm projects with separate Docker build
 * contexts, so the content schema is duplicated rather than imported. This spec
 * is the entire safety net for that decision: if the copies drift, the server
 * would validate one shape while the templates are typed against another.
 *
 * Fix a failure with `pnpm -C server content:sync` — never by editing the
 * mirrored copy.
 */
describe("content schema parity", () => {
  it("keeps the client mirror identical to the server canonical", () => {
    expect(sharedBody(MIRROR)).toBe(sharedBody(CANONICAL));
  });
});
