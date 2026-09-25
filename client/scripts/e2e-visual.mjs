// `pnpm e2e:visual [playwright args]`: the design-review screenshots
// (e2e/visual.spec.ts), which `pnpm e2e` leaves out. Sets the variable that
// defines their project in playwright.config.ts — here rather than in the
// package script, which would need a different syntax on Windows — and
// passes any further arguments through (`--update-snapshots`, `--grep home`).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const { status } = spawnSync(
  process.execPath,
  [cli, "test", "--project=visual", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, E2E_VISUAL: "1" } },
);

process.exit(status ?? 1);
