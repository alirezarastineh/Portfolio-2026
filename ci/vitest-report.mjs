// Fails a CI step unless a vitest JSON report shows a clean run with tests in
// it, and prints the counts. The exit code alone once lied: embedded-postgres's
// exit hook turned failing runs into exit 0 (server/src/test/pg-global-setup.ts).
//
// Usage: node ci/vitest-report.mjs <report.json> [label]
import { readFileSync } from "node:fs";

const [file, label = "vitest"] = process.argv.slice(2);
if (!file) {
  console.error("usage: node ci/vitest-report.mjs <report.json> [label]");
  process.exit(2);
}

const report = JSON.parse(readFileSync(file, "utf8"));
const files = report.testResults?.length ?? 0;
console.log(
  `${label}: ${report.numPassedTests}/${report.numTotalTests} tests passed in ${files} files ` +
    `(${report.numFailedTests} failed, ${report.numPendingTests} skipped, ${report.numTodoTests} todo, ` +
    `${report.numFailedTestSuites} failed suites)`,
);

// A file that fails to load counts as a failed suite, not a failed test.
if (
  report.success !== true ||
  report.numFailedTests !== 0 ||
  report.numFailedTestSuites !== 0 ||
  report.numTotalTests <= 0
) {
  console.error(`${label}: the report does not show a clean run`);
  process.exit(1);
}
