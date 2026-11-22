// /en's scripts, one by one, against the last main run's (plan 5: visitors pay nothing for the
// admin). It serves the build, opens /en on a phone and on a laptop in Playwright's Chromium, keeps
// every script it loads from the site, and matches them with the baseline's by name, hashes
// stripped: byte-identical, the same text with chunk names renamed, or different. It fails when
// /en's scripts grow by more than 0.1 KB brotli, unless the pushed commit's message has a line
// "Visitors-Pay: accepted" (a package upgrade that grows them on purpose). Without a baseline it
// records and passes. A push to main that passes keeps its record as the next baseline (the
// workflow copies it into the cache).
//
// Usage, from client/ after the build:
//   node ../ci/en-scripts.mjs <record.json> [baseline.json]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const [recordFile, baselineFile] = process.argv.slice(2);
if (!recordFile) {
  console.error("usage: node ci/en-scripts.mjs <record.json> [baseline.json]");
  process.exit(2);
}
const LIMIT = 100;
const PORT = 4190;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const onGitHub = process.env.GITHUB_ACTIONS === "true";
const accepted = /^Visitors-Pay: accepted\b/m.test(process.env.HEAD_COMMIT_MESSAGE ?? "");
const VIEWPORTS = [
  { width: 412, height: 823 },
  { width: 1350, height: 940 },
];

const strip = (url) =>
  new URL(url).pathname.split("/").pop().replace(/-[\w-]{8}\.js$/, ".js");
const unhash = (text) => text.replaceAll(/-[\w-]{8}\.js/g, ".js");
const brotli = (text) =>
  brotliCompressSync(Buffer.from(text), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
};

/** The build's server on PORT, from client/ (e2e/serve.mjs, as Playwright's web server). */
function startServer() {
  const server = spawn(process.execPath, ["e2e/serve.mjs", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the server did not start in 60 s")), 60_000);
    const on = (data) => {
      if (!String(data).includes("Listening on")) {
        return;
      }
      clearTimeout(timer);
      resolve(server);
    };
    server.stdout.on("data", on);
    server.stderr.on("data", on);
    server.on("exit", (code) => reject(new Error(`the server exited (${code})`)));
  });
}

/** Every script /en loads from the site at one viewport, by URL. */
async function visit(browser, viewport) {
  const phone = viewport.width < 700;
  const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone });
  const page = await context.newPage();
  const scripts = new Map();
  page.on("response", async (response) => {
    const url = response.url();
    if (response.request().resourceType() !== "script" || !url.startsWith(ORIGIN)) {
      return;
    }
    scripts.set(url, await response.text().catch(() => ""));
  });
  await page.goto(`${ORIGIN}/en`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await context.close();
  return scripts;
}

async function record() {
  const require = createRequire(join(process.cwd(), "package.json"));
  const { chromium } = require("@playwright/test");
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const seen = await Promise.all(VIEWPORTS.map((viewport) => visit(browser, viewport)));
    const scripts = new Map(seen.flatMap((map) => [...map]));
    return [...scripts].map(([url, text]) => ({
      file: url.split("/").pop(),
      name: strip(url),
      text,
    }));
  } finally {
    await browser.close();
    server.kill();
  }
}

/** The old script that `test` picks, taken out of `left`, or null. */
function take(left, test) {
  const at = left.findIndex((script) => test(script));
  return at < 0 ? null : left.splice(at, 1)[0];
}

/** The scripts' brotli bytes, all together. */
function total(list) {
  return list.reduce((n, s) => n + brotli(s.text), 0);
}

/** Pairs identical bytes, then the same text with chunk names renamed, then the nearest size. */
function compare(before, after) {
  const left = [...before];
  const same = after.filter((s) => take(left, (o) => o.text === s.text));
  const rest = after.filter((s) => !same.includes(s));
  const renamed = rest.filter((s) =>
    take(left, (o) => o.name === s.name && unhash(o.text) === unhash(s.text)),
  );
  const lines = [];
  for (const s of rest.filter((r) => !renamed.includes(r))) {
    const near = (o) => Math.abs(o.text.length - s.text.length);
    const old = left.filter((o) => o.name === s.name).sort((x, y) => near(x) - near(y))[0];
    if (old) {
      left.splice(left.indexOf(old), 1);
      lines.push(`${s.file} (was ${old.file}): ${brotli(old.text)} → ${brotli(s.text)} B brotli`);
    } else {
      lines.push(`new: ${s.file}, ${brotli(s.text)} B brotli`);
    }
  }
  for (const gone of left) {
    lines.push(`gone: ${gone.file}, ${brotli(gone.text)} B brotli`);
  }
  return {
    same: same.length,
    renamed: renamed.length,
    differ: after.length - same.length - renamed.length,
    lines,
    before: total(before),
    after: total(after),
  };
}

const after = await record();
writeFileSync(recordFile, JSON.stringify(after));

if (!baselineFile || !existsSync(baselineFile)) {
  const line = `/en loads ${after.length} scripts; no baseline yet, so this record is the first`;
  console.log(onGitHub ? `::notice title=en-scripts::${line}` : line);
  summary(`### en-scripts\n\n${line}.\n`);
  process.exit(0);
}

const before = JSON.parse(readFileSync(baselineFile, "utf8"));
const c = compare(before, after);
const delta = c.after - c.before;
const counts = `${c.same} byte-identical, ${c.renamed} renamed only, ${c.differ} differ`;
const bytes = `brotli ${c.before} → ${c.after} B, ${signed(delta)} B`;
const scripts = `${after.length} scripts (${before.length} on main's last run)`;
const head = `/en: ${scripts}: ${counts}; ${bytes}`;
console.log(head);
for (const line of c.lines) {
  console.log(`  ${line}`);
}
const list = c.lines.map((l) => `- ${l}`).join("\n");
summary(`### en-scripts\n\n${head}.\n\n${list}\n`);

if (delta > LIMIT && !accepted) {
  const how = 'a commit that grows it on purpose says "Visitors-Pay: accepted"';
  const line = `${head}: over the ${LIMIT} B a change may add to /en; ${how}`;
  console.log(onGitHub ? `::error title=en-scripts::${line}` : line);
  process.exit(1);
}
const verdict = delta > LIMIT ? `${head} (accepted by the commit)` : head;
console.log(onGitHub ? `::notice title=en-scripts::${verdict}` : verdict);
