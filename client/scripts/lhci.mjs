// `pnpm lhci`: what `lhci autorun` does — collect, assert, upload the reports,
// exit with the assertions' status — without its health check. That check
// only warns about one thing here: no GitHub token, which matters for posting
// GitHub status checks, and this project never posts them (the reports go to
// .lighthouseci/reports, which CI keeps as an artifact). Collect fails loudly
// on its own if Chrome is missing, the other thing the check covers.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@lhci/cli/src/cli.js");
const run = (command) =>
  spawnSync(process.execPath, [cli, command], { stdio: "inherit" }).status ?? 1;

const collected = run("collect");
if (collected !== 0) process.exit(collected);

const asserted = run("assert");
// Uploaded even when an assertion failed: that is when the reports matter.
if (run("upload") !== 0) process.stderr.write("upload failed\n");

process.exit(asserted);
