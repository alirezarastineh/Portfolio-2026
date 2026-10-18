// Keeps the two CI definitions in step (the GitHub Actions plan, Phase 2): both CIs'
// repo workflows run it. Twins are .woodpecker/<name>.yaml and
// .github/workflows/<name>.yml; it fails when:
// - a check step of one twin is missing from the other (checks have lower-case names;
//   GitHub's setup steps are capitalised, and each CI has a short list of its own);
// - an image both CIs name differs in tag or digest;
// - a GitHub action isn't pinned to a full commit SHA with its version in a comment;
// - the twins' pull request path filters differ, each CI's own files aside.
// It reads the workflows as text, with no YAML parser to install: both keep one shape
// (steps as `- name:` items, filters as lists), and the fixture cases cover it.
//   node ci/ci-parity.mjs [repo-root]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? ".";
// Steps only one CI has, and why.
const ONLY = {
  // owner: hands the root-owned clone to the CI image's user; wait-pg: GitHub's service
  // health check waits instead; pw-version: GitHub installs the lockfile's browsers;
  // reports, untag, email: artifacts, a discarded VM and GitHub's own notifications.
  woodpecker: new Set([
    "owner",
    "wait-pg",
    "pw-version",
    "reports",
    "untag",
    "email",
  ]),
  // inactivity: GitHub switches schedules off after 60 days without activity.
  github: new Set(["inactivity"]),
};
// Paths in a pull request filter that only one CI's steps read.
const ONLY_PATHS = [
  /^\.woodpecker\//,
  /^\.github\//,
  /^ci\/save-reports\.sh$/,
  /^ci\/smoke\.Dockerfile/,
];

const problems = [];
const read = (path) => readFileSync(join(root, path), "utf8");
// Comments out, so an image or path named in prose is never read as one.
const uncomment = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, ""))
    .join("\n");

/** The lines of a top-level section (`steps:`, `when:`, `on:`), or [] without one. */
function section(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (l) => l === `${key}:` || l.startsWith(`${key}: `),
  );
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** Check steps: Woodpecker's top-level `steps:` items; every `- name:` item of a job. */
function steps(text, ci) {
  const lines =
    ci === "woodpecker" ? section(text, "steps") : section(text, "jobs");
  const pattern =
    ci === "woodpecker" ? /^ {2}- name: (\S+)\s*$/ : /^\s+- name: (\S+)\s*$/;
  return new Set(
    lines
      .map((l) => pattern.exec(l)?.[1])
      .filter(
        (name) => name && /^[a-z][a-z0-9-]*$/.test(name) && !ONLY[ci].has(name),
      ),
  );
}

/** Image references: name:tag[@digest] tokens whose tag has a digit. A name of
 * digits alone is a port mapping (`5432:5432`), not an image. */
function images(text) {
  const ref =
    /^([a-z0-9]+(?:[._/-][a-z0-9]+)*):(\w[\w.-]*)(@sha256:[0-9a-f]{64})?$/;
  const found = new Map();
  for (const token of uncomment(text).split(/[\s"'`,[\]{}()]+/)) {
    const m = ref.exec(token);
    if (m && /\d/.test(m[2]) && !/^\d+$/.test(m[1]))
      found.set(m[1], new Set([...(found.get(m[1]) ?? []), token]));
  }
  return found;
}

/** A pull request filter: { pr: boolean, paths: string[] | null } (null paths = all paths). */
function prPaths(text, ci) {
  if (ci === "woodpecker") {
    const items = section(text, "when")
      .join("\n")
      .split(/\n(?= {2}- )/);
    const pr = items.find((item) =>
      /event: (\[[^\]]*\b)?pull_request\b/.test(item),
    );
    if (!pr) return { pr: false, paths: null };
    const include = pr.split(/\n +include:\n/)[1];
    return { pr: true, paths: include ? listItems(include) : null };
  }
  const on = `${section(text, "on").join("\n")}\n`;
  const pr = /^ {2}pull_request:.*\n((?: {4}.*\n)*)/m.exec(on);
  if (!pr) return { pr: false, paths: null };
  const paths = /^ {4}paths:\s*\n((?: {6}.*\n)*)/m.exec(pr[1]);
  return { pr: true, paths: paths ? listItems(paths[1]) : null };
}
const listItems = (block) =>
  [...uncomment(block).matchAll(/^ +- (.+)$/gm)]
    .map((m) => m[1].trim().replace(/^"|"$/g, ""))
    .filter((path) => !ONLY_PATHS.some((only) => only.test(path)))
    .sort((a, b) => a.localeCompare(b));

const woodpecker = readdirSync(join(root, ".woodpecker")).filter((f) =>
  f.endsWith(".yaml"),
);
const githubDir = join(root, ".github/workflows");
const github = existsSync(githubDir)
  ? readdirSync(githubDir).filter((f) => f.endsWith(".yml"))
  : [];

// Twins: the same steps, the same pull request filter.
const unpaired = [];
for (const file of woodpecker) {
  const name = file.replace(/\.yaml$/, "");
  if (!github.includes(`${name}.yml`)) {
    unpaired.push(name);
    continue;
  }
  const wp = read(`.woodpecker/${file}`);
  const gh = read(`.github/workflows/${name}.yml`);
  const [a, b] = [steps(wp, "woodpecker"), steps(gh, "github")];
  for (const step of a)
    if (!b.has(step))
      problems.push(`${name}: step ${step} is in Woodpecker only`);
  for (const step of b)
    if (!a.has(step)) problems.push(`${name}: step ${step} is in GitHub only`);
  const [pa, pb] = [prPaths(wp, "woodpecker"), prPaths(gh, "github")];
  if (JSON.stringify(pa) !== JSON.stringify(pb)) {
    problems.push(
      `${name}: the pull request filters differ: Woodpecker ${JSON.stringify(pa)}, GitHub ${JSON.stringify(pb)}`,
    );
  }
}

// Images: one pin per image, whichever CI names it.
const pins = { woodpecker: new Map(), github: new Map() };
for (const [ci, dir, files] of [
  ["woodpecker", ".woodpecker", woodpecker],
  ["github", ".github/workflows", github],
]) {
  for (const file of files) {
    for (const [name, refs] of images(read(`${dir}/${file}`))) {
      pins[ci].set(name, new Set([...(pins[ci].get(name) ?? []), ...refs]));
    }
  }
}
for (const [name, refs] of pins.github) {
  if (!pins.woodpecker.has(name)) continue;
  const all = new Set([...refs, ...pins.woodpecker.get(name)]);
  if (all.size > 1)
    problems.push(
      `image ${name} is pinned differently: ${[...all].join(", ")}`,
    );
}

// Actions: a full commit SHA, with the version it is in a comment.
for (const file of github) {
  for (const [i, line] of read(`.github/workflows/${file}`)
    .split("\n")
    .entries()) {
    const m = /^\s*(?:- )?uses:\s*(\S+)/.exec(line);
    if (!m || m[1].startsWith("./")) continue;
    if (
      !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(m[1]) ||
      !/#\s*v\d/.test(line)
    ) {
      problems.push(
        `${file}:${i + 1}: ${m[1]} is not pinned to a commit SHA with a "# v…" comment`,
      );
    }
  }
}

const checked = woodpecker.length - unpaired.length;
console.log(
  `parity: ${checked} twin workflow(s), ${pins.github.size} GitHub image(s), ${github.length} GitHub workflow(s) checked` +
    (unpaired.length ? `; no GitHub twin yet: ${unpaired.join(", ")}` : ""),
);
if (problems.length) {
  for (const problem of problems) console.error(`  FAIL ${problem}`);
  process.exit(1);
}
