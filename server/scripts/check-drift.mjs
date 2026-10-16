// Fails when src/db/schema.ts and the migrations disagree (plan Phase 7):
// drizzle-kit generate, run with the real config but writing into a copy of
// drizzle/, must find nothing to migrate. A rename question fails too, since
// drizzle-kit refuses prompts without a terminal. Either way, schema.ts
// changed without its migration.
//
// CI only: drizzle.config.ts loads the .env it finds, the real one on a dev
// machine, so this refuses to run beside one.
//
// Usage: node scripts/check-drift.mjs
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const env of [join(server, ".env"), join(server, "..", ".env")]) {
  if (existsSync(env)) {
    console.error(
      `check-drift: ${env} exists, and drizzle.config.ts would load it; this check runs in CI`,
    );
    process.exit(2);
  }
}

const migrations = join(server, "drizzle");
const tmp = mkdtempSync(join(tmpdir(), "drift-"));
const copy = join(tmp, "drizzle");
cpSync(migrations, copy, { recursive: true });
// drizzle-kit takes no --out beside a config file: a config of its own, which
// is the real one writing into the copy. Relative to server/, since drizzle-kit
// reads the snapshots as `./${out}/meta/…`.
const config = join(tmp, "drizzle.config.ts");
writeFileSync(
  config,
  `import config from ${JSON.stringify(join(server, "drizzle.config.ts"))};\n` +
    `export default { ...config, out: ${JSON.stringify(relative(server, copy))} };\n`,
);

const SECONDS = 120;
const run = spawnSync(
  process.execPath,
  [join(server, "node_modules/drizzle-kit/bin.cjs"), "generate", `--config=${config}`],
  { cwd: server, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: SECONDS * 1000 },
);
const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();

const files = (root) =>
  readdirSync(root, { recursive: true })
    .map(String)
    .filter((path) => statSync(join(root, path)).isFile());
const before = new Set(files(migrations));
const written = files(copy).filter(
  (path) =>
    !before.has(path) ||
    !readFileSync(join(copy, path)).equals(readFileSync(join(migrations, path))),
);

// drizzle-kit exits 0 after its own errors (a refused prompt, an unreadable
// snapshot) and when it finds no schema file: only its output tells.
let problem = null;
if (run.error?.code === "ETIMEDOUT") {
  problem = `drizzle-kit generate was still running after ${SECONDS} s`;
} else if (run.error) {
  problem = `drizzle-kit generate did not start: ${run.error.message}`;
} else if (output.includes("Interactive prompts require a TTY")) {
  problem =
    "schema.ts has changes no migration holds, and drizzle-kit generate asked about them (a " +
    "rename?), which it cannot without a terminal: generate that migration locally";
} else if (run.status !== 0) {
  problem = `drizzle-kit generate failed (exit ${run.status ?? run.signal})`;
} else if (written.length > 0) {
  problem = `schema.ts has changes no migration holds; drizzle-kit generate wrote ${written.join(", ")}`;
} else if (!output.includes("nothing to migrate")) {
  problem = 'drizzle-kit generate did not report "nothing to migrate": see its output above';
}

if (problem) {
  console.error(output);
  for (const path of written.filter((path) => path.endsWith(".sql"))) {
    console.error(
      `\n${path}, the migration schema.ts needs:\n${readFileSync(join(copy, path), "utf8")}`,
    );
  }
  console.error(`\ncheck-drift: ${problem}`);
} else {
  const tables = /^(\d+) tables$/m.exec(output)?.[1];
  const count = tables ? ` (${tables} tables)` : "";
  console.log(`drift: none; drizzle-kit generate finds nothing to migrate${count}`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(problem ? 1 : 0);
