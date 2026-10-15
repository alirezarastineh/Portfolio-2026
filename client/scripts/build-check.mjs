// `node scripts/build-check.mjs [vite build args]`: `vite build`, held to the
// project's rule that a clean build prints no warnings and prerenders no
// index.html (the SSR server renders every page). Local runs and CI use this
// same script. The output streams through as usual. Anything on stderr counts
// as a warning, since a clean build writes nothing there; so does a stdout line
// that says warn/warning or starts with Rollup's "(!)".
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

// Vite's package exports leave out its bin, so it is found through package.json.
const require = createRequire(import.meta.url);
const manifest = require.resolve("vite/package.json");
const vite = join(dirname(manifest), require(manifest).bin.vite);
const prerendered = fileURLToPath(new URL("../dist/analog/public/index.html", import.meta.url));

// The emitted-files table ("dist/…/x.js  12.3 kB │ gzip: …") names files, not problems.
const sizeRow = /\s[\d.]+ (?:B|kB|MB)\b/;
const warningLine = /(?:^\(!\))|\bwarn(?:ing)?s?\b/i;
const warnings = [];

function check(raw, isWarning) {
  const line = stripVTControlCharacters(raw).trim();
  if (line && isWarning(line)) warnings.push(line);
}

/** Passes one child stream through to `sink` and keeps the lines `isWarning` picks. */
function watch(stream, sink, isWarning) {
  let rest = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    sink.write(chunk);
    const lines = (rest + chunk).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) check(line, isWarning);
  });
  stream.on("end", () => check(rest, isWarning));
}

const child = spawn(process.execPath, [vite, "build", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "pipe"],
});
watch(child.stdout, process.stdout, (line) => !sizeRow.test(line) && warningLine.test(line));
watch(child.stderr, process.stderr, () => true);

const code = await new Promise((resolve) => child.on("close", (status) => resolve(status ?? 1)));
if (code !== 0) process.exit(code);

const problems = [];
if (warnings.length > 0) {
  problems.push(`${warnings.length} warning line(s):`, ...warnings.map((line) => `  ${line}`));
}
if (existsSync(prerendered)) {
  problems.push(
    `${prerendered} exists: the build prerendered a page the SSR server should render.`,
  );
}
if (problems.length > 0) {
  process.stderr.write(`\nbuild-check failed\n${problems.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("\nbuild-check: no warnings, no prerendered index.html\n");
