// The weekly check of Woodpecker's version (plan Phase 13, .woodpecker/weekly.yaml).
// - The server, the agent and the CLI that lints the workflows must be pinned to
//   one version (deploy/woodpecker/README.md, "Upgrade").
// - That version is checked against GitHub's latest release. A newer one fails
//   the step once it has been out for two weeks, the age this repo waits for
//   before taking a release, so the weekly email says an upgrade is due.
// GitHub's weekly runs it too (the GitHub Actions plan, Phase 8). It sends
// GITHUB_TOKEN when that is set: GitHub's runners get 1,000 requests an hour with
// it, against 60 an address. On GitHub Actions, the result also goes on the
// run's page, which reads without a login, and in the job's summary.
//
// Usage: node ci/woodpecker-version.mjs (from the repo root)
import { appendFileSync, readFileSync } from "node:fs";

const WAIT_DAYS = 14;
const pins = {
  server: [
    "deploy/woodpecker/docker-compose.server.yml",
    /woodpeckerci\/woodpecker-server:v([\d.]+)/,
  ],
  agent: [
    "deploy/woodpecker/docker-compose.agent.yml",
    /woodpeckerci\/woodpecker-agent:v([\d.]+)/,
  ],
  cli: [".woodpecker/repo.yaml", /woodpeckerci\/woodpecker-cli:v([\d.]+)/],
};

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
  console.log(`::${level} title=woodpecker::${message}`);
}
/** Prints a line, and on GitHub reports it too. */
const say = (line, level) => {
  console.log(line);
  github(line, level);
};
const fail = (line) => {
  console.error(line);
  github(line, "error");
  process.exit(1);
};

const versions = Object.entries(pins).map(([name, [file, pattern]]) => {
  const version = readFileSync(file, "utf8").match(pattern)?.[1];
  if (!version) fail(`no ${name} version in ${file}`);
  return [name, version];
});
const pinned = versions[0][1];
const formatted = versions
  .map(([name, version]) => `${name} v${version}`)
  .join(", ");
say(`pinned: ${formatted}`);
if (versions.some(([, version]) => version !== pinned)) {
  fail(
    "the pins differ: the server, the agent and the CLI must run one version",
  );
}

const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "portfolio-ci",
};
if (process.env.GITHUB_TOKEN)
  headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const response = await fetch(
  "https://api.github.com/repos/woodpecker-ci/woodpecker/releases/latest",
  { headers },
);
if (!response.ok) {
  fail(`GitHub answered ${response.status} for Woodpecker's latest release`);
}
const release = await response.json();
const latest = release.tag_name.replace(/^v/, "");
const days = Math.floor(
  (Date.now() - Date.parse(release.published_at)) / 86_400_000,
);

const parts = (version) => version.split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

if (!newer(latest, pinned)) {
  say(`v${pinned} is the latest release`, "notice");
} else if (days < WAIT_DAYS) {
  say(
    `v${latest} is out (${days} days ago): it is due once ${WAIT_DAYS} days old`,
    "notice",
  );
} else {
  fail(
    `v${latest} has been out for ${days} days, and v${pinned} is pinned: upgrade (deploy/woodpecker/README.md, "Upgrade"), reading every release's notes: ${release.html_url}`,
  );
}
