// The weekly check of Woodpecker's version (plan Phase 13, .woodpecker/weekly.yaml).
// - The server, the agent and the CLI that lints the workflows must be pinned to
//   one version (deploy/woodpecker/README.md, "Upgrade").
// - That version is checked against GitHub's latest release. A newer one fails
//   the step once it has been out for two weeks, the age this repo waits for
//   before taking a release, so the weekly email says an upgrade is due.
//
// Usage: node ci/woodpecker-version.mjs (from the repo root)
import { readFileSync } from "node:fs";

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

const versions = Object.entries(pins).map(([name, [file, pattern]]) => {
  const version = readFileSync(file, "utf8").match(pattern)?.[1];
  if (!version) {
    console.error(`no ${name} version in ${file}`);
    process.exit(1);
  }
  return [name, version];
});
const pinned = versions[0][1];
const formatted = versions
  .map(([name, version]) => `${name} v${version}`)
  .join(", ");
console.log(`pinned: ${formatted}`);
if (versions.some(([, version]) => version !== pinned)) {
  console.error(
    "the pins differ: the server, the agent and the CLI must run one version",
  );
  process.exit(1);
}

const response = await fetch(
  "https://api.github.com/repos/woodpecker-ci/woodpecker/releases/latest",
  {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "portfolio-ci",
    },
  },
);
if (!response.ok) {
  console.error(
    `GitHub answered ${response.status} for Woodpecker's latest release`,
  );
  process.exit(1);
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
  console.log(`v${pinned} is the latest release`);
} else if (days < WAIT_DAYS) {
  console.log(
    `v${latest} is out (${days} days ago): it is due once ${WAIT_DAYS} days old`,
  );
} else {
  console.error(
    `v${latest} has been out for ${days} days, and v${pinned} is pinned: upgrade (deploy/woodpecker/README.md, "Upgrade"), reading every release's notes: ${release.html_url}`,
  );
  process.exit(1);
}
