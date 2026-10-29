// What browsers download (plan Phase 9): the raw and brotli totals of the
// client's built .js and .css, the largest files, and the change against the
// last main run, whose totals the agent keeps (GitHub Actions: its cache).
// Advisory: Lighthouse gates the bytes per page, so this only reports. A push to
// main saves its totals as the next baseline; dry runs (pipeline 0) and pull
// requests never do.
//
// Usage, from client/ after the build:
//   node ../ci/bundle-size.mjs dist/analog/public/assets [baseline.json]
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const [dir, baselineFile] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node ci/bundle-size.mjs <assets-dir> [baseline.json]");
  process.exit(2);
}

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
const signed = (bytes) => `${bytes >= 0 ? "+" : "-"}${kb(Math.abs(bytes))}`;
const percent = (now, before) => {
  if (!before) return "new";
  const sign = now >= before ? "+" : "";
  const pct = (((now - before) / before) * 100).toFixed(1);
  return `${sign}${pct}%`;
};

// The build's own .br copies are what gets served (compressPublicAssets);
// the few small files it leaves raw are compressed here.
const files = readdirSync(dir)
  .filter((name) => [".js", ".css"].includes(extname(name)))
  .map((name) => {
    const content = readFileSync(join(dir, name));
    const served = join(dir, `${name}.br`);
    const brotli = existsSync(served)
      ? readFileSync(served).length
      : brotliCompressSync(content, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length;
    return { name, kind: extname(name).slice(1), raw: content.length, brotli };
  });
if (files.length === 0) {
  console.error(`bundle: no .js or .css in ${dir}: did the build run?`);
  process.exit(1);
}

const totals = {};
for (const { kind, raw, brotli } of files) {
  totals[kind] ??= { files: 0, raw: 0, brotli: 0 };
  totals[kind].files += 1;
  totals[kind].raw += raw;
  totals[kind].brotli += brotli;
}
const sizes = `bundle: ${Object.entries(totals)
  .map(
    ([kind, t]) =>
      `${kind} ${t.files} files, ${kb(t.raw)} raw, ${kb(t.brotli)} brotli`,
  )
  .join("; ")}`;
console.log(sizes);

const baseline =
  baselineFile && existsSync(baselineFile)
    ? JSON.parse(readFileSync(baselineFile, "utf8"))
    : null;
let change = "no baseline yet: the next push to main saves one";
if (baseline) {
  const changes = Object.entries(totals).map(([kind, t]) => {
    const before = baseline.totals[kind]?.brotli ?? 0;
    return `${kind} ${signed(t.brotli - before)} brotli (${percent(t.brotli, before)})`;
  });
  change = `against main #${baseline.pipeline} (${baseline.commit.slice(0, 7)}): ${changes.join(", ")}`;
}
console.log(`  ${change}`);

console.log("largest, brotli (raw):");
for (const f of [...files].sort((a, b) => b.brotli - a.brotli).slice(0, 8)) {
  console.log(`  ${kb(f.brotli).padStart(9)} (${kb(f.raw)})  ${f.name}`);
}
// The lazy chunks the plans name, whatever their size (visitor plan V20: match's paste
// box): each must stay its own chunk, loaded only when its feature is used.
const WATCHED = ["match-box.component"];
const watched = `lazy: ${WATCHED.map((name) => {
  const f = files.find((file) => file.name.startsWith(`${name}-`));
  return f ? `${name} ${kb(f.brotli)} brotli (${kb(f.raw)})` : `${name} not built apart`;
}).join("; ")}`;
console.log(watched);
// Vite's own chunk-size warning, which this build never prints (plan Phase 3).
const big = files.filter((f) => f.raw > 500_000);
if (big.length > 0)
  console.log(`over 500 kB raw: ${big.map((f) => f.name).join(", ")}`);

const env = process.env;
// On GitHub Actions (the GitHub Actions plan, Phase 4), the totals and the
// change also go to the job's summary and, as a notice, onto the run's page,
// which shows annotations to readers without a login.
if (env.GITHUB_STEP_SUMMARY) {
  appendFileSync(env.GITHUB_STEP_SUMMARY, `- ${sizes}\n- ${change}\n- ${watched}\n`);
  const message = `${sizes}\n${change}\n${watched}`
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.log(`::notice title=bundle-size::${message}`);
}
if (
  baselineFile &&
  env.CI_PIPELINE_EVENT === "push" &&
  env.CI_COMMIT_BRANCH === "main" &&
  env.CI_PIPELINE_NUMBER &&
  env.CI_PIPELINE_NUMBER !== "0"
) {
  mkdirSync(dirname(baselineFile), { recursive: true });
  writeFileSync(
    baselineFile,
    JSON.stringify(
      { pipeline: env.CI_PIPELINE_NUMBER, commit: env.CI_COMMIT_SHA, totals },
      null,
      2,
    ),
  );
  console.log(`saved as the baseline for the next run (${baselineFile})`);
}
