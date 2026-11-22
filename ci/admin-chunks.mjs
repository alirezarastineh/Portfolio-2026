// The admin's chunks against plan 5's budgets (the admin redesign): every `admin-…` chunk and the
// admin's stylesheet in brotli KB (÷ 1000, as the plan counts), from the build's own .br files.
// The layout's chunk (`admin.page`), which every admin page loads, may weigh at most 25 KB; the
// rest only report. The stylesheet is `admin.css?inline`, a string inside a chunk, so it is cut
// out and compressed alone.
//
// Usage, from client/ after the build:
//   node ../ci/admin-chunks.mjs dist/analog/public/assets
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const BUDGETS = new Map([["admin.page", 25]]);
// Chunks only the admin loads that its pages share, named by their module rather than `admin-…`.
const SHARED = new Set([
  "rich-text.component",
  "load-state.component",
  "recovery-banner.component",
  "live-preview.service",
  "sign-in-form.component",
]);
// The admin theme's own scope opens the stylesheet's rules (`styles/admin-theme.css`).
const MARK = ":root:root:has(app-admin-layout)";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node ci/admin-chunks.mjs <assets-dir>");
  process.exit(2);
}

const onGitHub = process.env.GITHUB_ACTIONS === "true";
const kb = (bytes) => Math.round(bytes / 100) / 10;
const brotli = (text) =>
  brotliCompressSync(Buffer.from(text), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
const report = (line) => console.log(onGitHub ? `::error title=admin-chunks::${line}` : line);

/** A brotli size: the build's own .br file, or compressed here when it has none. */
function sizeOf(path) {
  return statSync(`${path}.br`, { throwIfNoEntry: false })?.size ?? brotli(readFileSync(path));
}

/** The stylesheet's string inside a chunk's source, from Tailwind's banner to its closing quote. */
function sheetIn(src) {
  const at = src.indexOf(MARK);
  if (at === -1) {
    return null;
  }
  const start = src.lastIndexOf("/*! tailwindcss", at);
  const quote = src[start - 1];
  const escaped = (i) => {
    let n = 0;
    while (src[i - 1 - n] === "\\") {
      n++;
    }
    return n % 2 === 1;
  };
  let end = at;
  while (end < src.length && !(src[end] === quote && !escaped(end))) {
    end++;
  }
  return src.slice(start, end);
}

const chunks = [];
let sheet = null;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const path = join(dir, file);
  const name = file.replace(/-[\w-]{8}\.js$/, "");
  if (name.startsWith("admin-") || SHARED.has(name)) {
    chunks.push({ name: name.replace(/^admin-/, ""), file, kb: kb(sizeOf(path)) });
  }
  if (!sheet) {
    const css = sheetIn(readFileSync(path, "utf8"));
    if (css) {
      sheet = { file, raw: kb(css.length), br: kb(brotli(css)) };
    }
  }
}

chunks.sort((a, b) => b.kb - a.kb);
const over = chunks.filter((c) => BUDGETS.has(c.name) && c.kb > BUDGETS.get(c.name));
const missing = [...BUDGETS.keys()].filter((name) => !chunks.some((c) => c.name === name));
const label = (c) => {
  const budget = BUDGETS.has(c.name) ? ` of ${BUDGETS.get(c.name)}` : "";
  return `${c.name}: ${c.kb} KB${budget}`;
};
console.log(`admin chunks, brotli KB: ${chunks.map((c) => label(c)).join(", ")}`);
const sheetLine = sheet
  ? `admin stylesheet: ${sheet.raw} KB raw, ${sheet.br} KB brotli (in ${sheet.file})`
  : "admin stylesheet: not found";
console.log(sheetLine);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = chunks.map((c) => `| ${c.name} | ${c.kb} | ${BUDGETS.get(c.name) ?? ""} |`);
  const table = ["| Admin chunk | Brotli KB | Budget |", "|---|---:|---:|", ...rows].join("\n");
  const text = `### admin-chunks\n\n${table}\n\n${sheetLine}.\n\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
}
for (const c of over) {
  report(`${c.name} weighs ${c.kb} KB brotli, over its ${BUDGETS.get(c.name)} KB`);
}
for (const name of missing) {
  report(`no admin chunk named ${name}: its budget measures nothing`);
}
if (!sheet) {
  report("the admin stylesheet was not found");
}
if (over.length || missing.length || !sheet) {
  process.exit(1);
}
if (onGitHub) {
  const layout = chunks.find((c) => c.name === "admin.page");
  const line = `the layout ${layout?.kb} KB of 25; ${chunks.length} chunks`;
  console.log(`::notice title=admin-chunks::${line}`);
}
