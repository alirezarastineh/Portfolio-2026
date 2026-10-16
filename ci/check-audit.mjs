// Reads what `pnpm audit --prod --json` writes (plan Phase 8): prints the
// count per severity and one line per HIGH or CRITICAL advisory, and fails a
// CI step on any advisory at or above --fail-on. That is critical for now, the
// owner's choice (2026-10-16) while Analog's nx pins HIGHs nobody can fix
// here; HIGH blocks once upgrades bring the count down. A failed audit request
// fails too.
//
// Usage: node ../ci/check-audit.mjs <audit.json> [label] [--fail-on <severity>]
import { readFileSync } from "node:fs";

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

const report = JSON.parse(readFileSync(file, "utf8"));
const counts = report.metadata?.vulnerabilities;
if (report.error || !counts) {
  console.error(
    `${label}: pnpm audit gave no report: ${report.error?.message ?? "no metadata"}`,
  );
  process.exit(1);
}

const advisories = Object.values(report.advisories ?? {}).sort(
  (a, b) =>
    LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity) ||
    a.module_name.localeCompare(b.module_name),
);
console.log(
  `${label}: ${[...LEVELS]
    .reverse()
    .map((level) => `${counts[level] ?? 0} ${level}`)
    .join(", ")}`,
);
for (const a of advisories) {
  if (LEVELS.indexOf(a.severity) < LEVELS.indexOf("high")) continue;
  const versions = [...new Set(a.findings.map((f) => f.version))].join(", ");
  // The production dependency each path starts from: ".>@sentry/node>glob>…".
  const via = [
    ...new Set(a.findings.flatMap((f) => f.paths).map((p) => p.split(">")[1])),
  ];
  console.log(
    `  ${a.severity.padEnd(8)} ${a.module_name}@${versions}  ${a.github_advisory_id}  ` +
      `${a.title} (fixed ${a.patched_versions}; via ${via.join(", ")})`,
  );
}

const failing = advisories.filter(
  (a) => LEVELS.indexOf(a.severity) >= LEVELS.indexOf(failOn),
);
if (failing.length > 0) {
  console.error(
    `FAIL ${label}: ${failing.length} advisory(ies) at ${failOn} or above`,
  );
  process.exit(1);
}
