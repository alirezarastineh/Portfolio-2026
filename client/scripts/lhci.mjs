// `pnpm lhci`: what `lhci autorun` does — collect, assert, upload the reports,
// exit with the assertions' status — without its health check. That check
// only warns about one thing here: no GitHub token, which matters for posting
// GitHub status checks, and this project never posts them (the reports go to
// .lighthouseci/reports, which CI keeps as an artifact). Collect fails loudly
// on its own if Chrome is missing, the other thing the check covers.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@lhci/cli/src/cli.js");
const run = (command) =>
  spawnSync(process.execPath, [cli, command], { stdio: "inherit" }).status ?? 1;

const collected = run("collect");
if (collected !== 0) process.exit(collected);

const asserted = run("assert");
// On GitHub Actions (the GitHub Actions plan, Phase 4), each failed hard gate also
// goes on the run's page, which shows annotations to readers without a login, and
// every result, the performance warnings too, to the job's summary.
const results = ".lighthouseci/assertion-results.json";
if (process.env.GITHUB_STEP_SUMMARY && existsSync(results)) {
  const escape = (text) =>
    text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  for (const result of JSON.parse(readFileSync(results, "utf8"))) {
    const { auditId, auditProperty, url, actual, operator, expected, level } = result;
    const audit = auditProperty ? `${auditId}:${auditProperty}` : auditId;
    const line = `${audit} on ${new URL(url).pathname}: ${actual}, expected ${operator} ${expected}`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- lighthouse ${level}: ${line}\n`);
    if (level === "error") console.log(`::error title=lighthouse::${escape(line)}`);
  }
}
// Uploaded even when an assertion failed: that is when the reports matter.
if (run("upload") !== 0) process.stderr.write("upload failed\n");

process.exit(asserted);
