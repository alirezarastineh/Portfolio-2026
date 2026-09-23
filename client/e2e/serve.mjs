// Starts the production build (`pnpm build` first) the way the container runs
// it, with test defaults: a local fixture API instead of the real one (the
// bundled fallback plus test case studies, posts, experience and a CV — see
// fixture-content.mjs), so runs are deterministic and offline, and the CSP
// enforced. Used by Playwright and Lighthouse CI; also handy by hand:
// `node e2e/serve.mjs [--port 4173]`.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { startFixtureApi } from "./fixture-api.mjs";

const entry = new URL("../dist/analog/server/index.mjs", import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  console.error("No production build at dist/analog/server — run `pnpm build` first.");
  process.exit(1);
}

const { values } = parseArgs({ options: { port: { type: "string" } } });

process.env.HOST ??= "127.0.0.1";
process.env.PORT = values.port ?? process.env.PORT ?? "4173";
process.env.CSP_MODE ??= "enforce";
// Never live content, whatever the shell has set: the fixture API, on loopback.
process.env.API_INTERNAL_BASE_URL = await startFixtureApi();

await import(entry.href);
