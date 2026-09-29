/**
 * Draws the site's own social card, `public/og.png`: the `og:image` of home,
 * the writing index and the legal pages (the CMS's `seo.ogImage` points at
 * it), and what a case study's or post's card falls back to when drawing it
 * fails. Same renderer as those cards (src/server/utils/og.ts), from the
 * bundled English content (`fallback.en.json`).
 *
 * Run it after changing the cards' design, or after `pnpm fallback:refresh`
 * brought a new name, role or headline:
 *
 *   node_modules/.bin/tsx scripts/og-default.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appContentSchema } from "../src/app/content/schema";
import { ogSiteCard, renderOgPng } from "../src/server/utils/og";

const here = dirname(fileURLToPath(import.meta.url));
const font = (file: string) => readFileSync(resolve(here, "../src/server/assets/og", file));

const content = appContentSchema.parse(
  JSON.parse(readFileSync(resolve(here, "../src/app/content/fallback.en.json"), "utf8")),
);
const png = await renderOgPng(ogSiteCard(content, "en"), {
  regular: font("geist-latin-400-normal.woff"),
  semibold: font("geist-latin-600-normal.woff"),
  mono: font("geist-mono-latin-500-normal.woff"),
});

const out = resolve(here, "../public/og.png");
writeFileSync(out, png);
console.log(`[og] wrote ${out} (${png.length} bytes)`);
