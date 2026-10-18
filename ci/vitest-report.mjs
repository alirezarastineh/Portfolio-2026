// Fails a CI step unless a vitest JSON report shows a clean run with tests in
// it, and prints the counts. The exit code alone once lied: embedded-postgres's
// exit hook turned failing runs into exit 0 (server/src/test/pg-global-setup.ts).
// With --coverage it prints a json-summary's four figures instead, and passes.
// On GitHub Actions (the GitHub Actions plan, Phase 3), each line also goes to
// the job's summary and, as an annotation, onto the run's page, which the API
// shows without a login. Woodpecker sets neither, so its output is unchanged.
//
// Usage: node ci/vitest-report.mjs <report.json> [label]
//        node ci/vitest-report.mjs --coverage <coverage-summary.json> [label]
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const coverage = args[0] === "--coverage";
const [file, label = "vitest"] = coverage ? args.slice(1) : args;
if (!file) {
  console.error(
    "usage: node ci/vitest-report.mjs [--coverage] <report.json> [label]",
  );
  process.exit(2);
}

/** Prints a line; on GitHub, also a summary line and an annotation of `level`. */
function report(line, level = "notice") {
  (level === "error" ? console.error : console.log)(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  appendFileSync(summary, `- ${line}\n`);
  // Workflow commands escape %, CR and LF in their message.
  const message = line
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.log(`::${level} title=${label}::${message}`);
}

if (coverage) {
  if (!existsSync(file)) {
    report(`${label}: no coverage summary at ${file}`, "warning");
    process.exit(0);
  }
  const { total } = JSON.parse(readFileSync(file, "utf8"));
  const figures = ["lines", "statements", "functions", "branches"]
    .map((metric) => `${metric} ${total[metric].pct}%`)
    .join(", ");
  report(`${label}: ${figures}`);
  process.exit(0);
}

const run = JSON.parse(readFileSync(file, "utf8"));
const files = run.testResults?.length ?? 0;
report(
  `${label}: ${run.numPassedTests}/${run.numTotalTests} tests passed in ${files} files ` +
    `(${run.numFailedTests} failed, ${run.numPendingTests} skipped, ${run.numTodoTests} todo, ` +
    `${run.numFailedTestSuites} failed suites)`,
);

// A file that fails to load counts as a failed suite, not a failed test.
if (
  run.success !== true ||
  run.numFailedTests !== 0 ||
  run.numFailedTestSuites !== 0 ||
  run.numTotalTests <= 0
) {
  report(`${label}: the report does not show a clean run`, "error");
  process.exit(1);
}
