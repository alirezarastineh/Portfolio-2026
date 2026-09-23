import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { codeStylesheet } from "../content/highlight.js";

/**
 * `pnpm content:code-css` — writes the stylesheet for the classes the
 * publish-time highlighter emits (`content/highlight.ts`) into the client.
 * Re-run after changing the code themes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../../client/src/styles/code.css");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, await codeStylesheet(), "utf8");
console.log(`[code-css] wrote ${target}`);
