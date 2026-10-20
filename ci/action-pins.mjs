// The weekly check of the GitHub actions' pins (the GitHub Actions plan, Phase 8),
// in both CIs' weekly runs. Every `uses:` in .github/workflows names a commit SHA
// with its version in a comment (ci/ci-parity.mjs and zizmor see to that); this
// checks both against the action's own repository:
// - the SHA must be its version's commit: a typo, or a tag moved since, fails;
// - a newer release fails once it has been out for two weeks, the age this repo
//   waits for before taking a release, so the weekly email says a pin is due
//   (ci/README.md, "Action pins").
// It sends GITHUB_TOKEN when that is set: GitHub's runners get 1,000 requests an
// hour with it, against 60 an address. On GitHub Actions, the result also goes
// on the run's page, which reads without a login, and in the job's summary.
//
// Usage: node ci/action-pins.mjs [repo-root]
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WAIT_DAYS = 14;
const dir = join(process.argv[2] ?? ".", ".github/workflows");

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
  console.log(`::${level} title=action-pins::${message}`);
}

// One entry per action, SHA and version, with every place that uses it. A
// subpath (actions/cache/restore) lives in its action's repository.
const pins = new Map();
let uses = 0;
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".yml"))
  .sort()) {
  for (const [i, line] of readFileSync(join(dir, file), "utf8")
    .split("\n")
    .entries()) {
    const m =
      /^\s*(?:- )?uses:\s*([\w./-]+)@([0-9a-f]{40})\s*#\s*(v[\d.]+)/.exec(line);
    if (!m) continue;
    const [, path, sha, version] = m;
    const repo = path.split("/").slice(0, 2).join("/");
    const key = `${repo}@${sha} ${version}`;
    if (!pins.has(key)) pins.set(key, { repo, sha, version, at: [] });
    pins.get(key).at.push(`${file}:${i + 1}`);
    uses++;
  }
}

const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "portfolio-ci",
};
if (process.env.GITHUB_TOKEN)
  headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
async function get(path) {
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status} for ${path}`);
  return response.json();
}

const parts = (version) => version.replace(/^v/, "").split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

const releases = new Map();
function getRelease(repo) {
  if (!releases.has(repo)) {
    releases.set(
      repo,
      get(`repos/${repo}/releases/latest`).catch((error) => {
        releases.delete(repo);
        throw error;
      }),
    );
  }
  return releases.get(repo);
}

const sortedPins = [...pins.values()].sort((a, b) =>
  `${a.repo} ${a.version}`.localeCompare(`${b.repo} ${b.version}`),
);

const checkedPins = await Promise.all(
  sortedPins.map(async (pin) => {
    const where = pin.at.length === 1 ? pin.at[0] : `${pin.at.length} uses`;
    const label = `${pin.repo} ${pin.version} (${where})`;
    try {
      const [commitData, release] = await Promise.all([
        get(`repos/${pin.repo}/commits/${pin.version}`),
        getRelease(pin.repo),
      ]);
      return { pin, label, commit: commitData.sha, release };
    } catch (error) {
      return { pin, label, error: error.message };
    }
  }),
);

const problems = [];
for (const { pin, label, commit, release, error } of checkedPins) {
  if (error) {
    problems.push(`${label}: ${error}`);
    continue;
  }
  const notes = [];
  if (commit === pin.sha) notes.push(`${pin.version}'s commit`);
  else
    problems.push(
      `${label}: ${pin.sha} is not ${pin.version}'s commit, ${commit}: ${pin.at.join(", ")}`,
    );
  const latest = release.tag_name;
  const days = Math.floor(
    (Date.now() - Date.parse(release.published_at)) / 86_400_000,
  );
  if (!newer(latest, pin.version)) notes.push("the latest release");
  else if (days < WAIT_DAYS)
    notes.push(
      `${latest} is out (${days} days ago): it is due once ${WAIT_DAYS} days old`,
    );
  else
    problems.push(
      `${label}: ${latest} has been out for ${days} days: move the pin to its commit ` +
        `(ci/README.md, "Action pins"), reading every release's notes: ${release.html_url}`,
    );
  if (notes.length > 0) {
    const line = `${label}: ${notes.join("; ")}`;
    console.log(line);
    github(line);
  }
}

const actions = new Set([...pins.values()].map((pin) => pin.repo)).size;
const total = `action-pins: ${pins.size} pin(s) of ${actions} action(s), in ${uses} uses`;
if (problems.length === 0) {
  console.log(total);
  github(`${total}, all current`, "notice");
} else {
  for (const problem of problems) {
    console.error(`FAIL ${problem}`);
    github(problem, "error");
  }
  console.error(`${total}: ${problems.length} problem(s)`);
  github(`${total}: ${problems.length} problem(s)`);
  process.exit(1);
}
