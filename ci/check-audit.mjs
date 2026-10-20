// Reads what `pnpm audit --prod --json` writes (plan Phase 8): prints the
// count per severity and one line per HIGH or CRITICAL advisory, and fails a
// CI step on any advisory at or above --fail-on. That is critical for now, the
// owner's choice (2026-10-16) while Analog's nx pins HIGHs nobody can fix
// here; HIGH blocks once upgrades bring the count down. A failed audit request
// fails too.
// On GitHub Actions (the GitHub Actions plan, Phase 7), every line also goes to
// the job's summary, and the counts and each failing advisory onto the run's
// page as annotations, which read without a login. Woodpecker sets neither, so
// its output is unchanged.
//
// Usage: node ../ci/check-audit.mjs <audit.json> [label] [--fail-on <severity>]
import { appendFileSync, readFileSync } from "node:fs";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const args = process.argv.slice(2);
const at = args.indexOf("--fail-on");
const failOn = at === -1 ? "critical" : args.splice(at, 2)[1];
const [file, label = "audit"] = args;
if (!file || !LEVELS.includes(failOn)) {
  console.error(
    "usage: node ci/check-audit.mjs <audit.json> [label] [--fail-on info|low|moderate|high|critical]",
  );
  process.exit(2);
}

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
  console.log(`::${level} title=audit::${message}`);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const counts = report.metadata?.vulnerabilities;
if (report.error || !counts) {
  const line = `${label}: pnpm audit gave no report: ${report.error?.message ?? "no metadata"}`;
  console.error(line);
  github(line, "error");
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {}).sort(
  (a, b) =>
    LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity) ||
    a.module_name.localeCompare(b.module_name),
);
const fails = (a) => LEVELS.indexOf(a.severity) >= LEVELS.indexOf(failOn);
const totals = `${label}: ${[...LEVELS]
  .reverse()
  .map((level) => `${counts[level] ?? 0} ${level}`)
  .join(", ")}`;
console.log(totals);
github(totals, "notice");
for (const a of advisories) {
  if (LEVELS.indexOf(a.severity) < LEVELS.indexOf("high")) continue;
  const versions = [...new Set(a.findings.map((f) => f.version))].join(", ");
  // The production dependency each path starts from: ".>@sentry/node>glob>…".
  const via = [
    ...new Set(a.findings.flatMap((f) => f.paths).map((p) => p.split(">")[1])),
  ];
  const fixed = `(fixed ${a.patched_versions}; via ${via.join(", ")})`;
  console.log(
    `  ${a.severity.padEnd(8)} ${a.module_name}@${versions}  ${a.github_advisory_id}  ` +
      `${a.title} ${fixed}`,
  );
  github(
    `${label}: ${a.severity} ${a.module_name}@${versions} ${a.github_advisory_id} ${a.title} ${fixed}`,
    fails(a) ? "error" : undefined,
  );
}

const failing = advisories.filter(fails);
if (failing.length > 0) {
  const line = `FAIL ${label}: ${failing.length} advisory(ies) at ${failOn} or above`;
  console.error(line);
  github(line);
  process.exit(1);
}
