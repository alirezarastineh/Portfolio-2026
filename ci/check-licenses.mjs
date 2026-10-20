// Fails a CI step when a production dependency's licence is outside the
// allowlist (plan Phase 8), and prints the count per licence. It reads what
// `pnpm licenses list --prod --json` writes. Anything else, a GPL, an AGPL or a
// licence pnpm can't name, needs a waiver below, with its reason.
// On GitHub Actions (the GitHub Actions plan, Phase 7), the count, the waivers
// and the problems also go to the job's summary, and the count and each problem
// onto the run's page as annotations, which read without a login. Woodpecker
// sets neither, so its output is unchanged.
//
// Usage: node ../ci/check-licenses.mjs <licenses.json> [label]
import { appendFileSync, readFileSync } from "node:fs";

const [file, label = "licenses"] = process.argv.slice(2);
if (!file) {
  console.error("usage: node ci/check-licenses.mjs <licenses.json> [label]");
  process.exit(2);
}

// Permissive, plus MPL-2.0, whose copyleft covers only the files it licenses:
// using such a package as published is fine.
const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
  "Zlib",
]);

// A waiver holds while the package keeps the licence it was given for.
const WAIVERS = [
  {
    name: /^@img\/sharp-libvips-/,
    license: "LGPL-3.0-or-later",
    reason:
      "libvips, which sharp loads as a shared library: the LGPL allows that unmodified",
  },
  {
    name: /^sentry$/,
    license: "FSL-1.1-Apache-2.0",
    reason:
      "the Sentry CLI, under @sentry/node: the FSL allows any use but a competing product, and " +
      "turns into Apache-2.0 after two years",
  },
];

// SPDX: AND binds tighter than OR, so an expression is allowed when one of its
// OR branches has every AND term allowed.
const allowed = (expression) =>
  expression
    .replaceAll(/[()]/g, "")
    .split(" OR ")
    .some((branch) =>
      branch.split(" AND ").every((id) => ALLOWED.has(id.trim())),
    );

/** On GitHub, a summary line, and with `level` an annotation too. */
function github(line, level) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  appendFileSync(summary, `- ${line}\n`);
  if (!level) return;
  // Workflow commands escape %, CR and LF in their message.
  const message = line
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.log(`::${level} title=licenses::${message}`);
}

const report = JSON.parse(readFileSync(file, "utf8"));
if (report.error) {
  const line = `${label}: pnpm licenses failed: ${report.error.message}`;
  console.error(line);
  github(line, "error");
  process.exit(1);
}

const problems = [];
const waived = [];
let total = 0;
for (const [license, packages] of Object.entries(report).sort(
  (a, b) => b[1].length - a[1].length,
)) {
  total += packages.length;
  console.log(`${String(packages.length).padStart(4)} ${license}`);
  if (allowed(license)) continue;
  for (const { name, versions } of packages) {
    const id = `${name}@${versions.join(", ")}`;
    const waiver = WAIVERS.find(
      (w) => w.name.test(name) && w.license === license,
    );
    if (waiver) waived.push(`${id} (${license}): ${waiver.reason}`);
    else problems.push(`${id} is ${license}, outside the allowlist`);
  }
}

const count = `${label}: ${total} production packages`;
console.log(count);
github(count, "notice");
for (const line of waived) {
  console.log(`  waived: ${line}`);
  github(`${label}: waived ${line}`);
}
if (total === 0)
  problems.push("no packages listed: was the package installed?");
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
    github(`${label}: ${problem}`, "error");
  }
  const line = `${label}: ${problems.length} problem(s)`;
  console.error(line);
  github(line);
  process.exit(1);
}
