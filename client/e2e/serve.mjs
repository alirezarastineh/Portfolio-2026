// Starts the production build (`pnpm build` first) the way the container runs
// it, with test defaults: the bundled fallback content instead of the API, so
// runs are deterministic and offline, and the CSP enforced. Used by Playwright
// and Lighthouse CI; also handy by hand: `node e2e/serve.mjs [--port 4173]`.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const entry = new URL("../dist/analog/server/index.mjs", import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  console.error("No production build at dist/analog/server — run `pnpm build` first.");
  process.exit(1);
}

const { values } = parseArgs({ options: { port: { type: "string" } } });

process.env.HOST ??= "127.0.0.1";
process.env.PORT = values.port ?? process.env.PORT ?? "4173";
process.env.CSP_MODE ??= "enforce";
// Empty on purpose: never read live content, whatever the shell has set.
process.env.API_INTERNAL_BASE_URL = "";

await import(entry.href);
