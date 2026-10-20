// The deploy workflow's first step (.woodpecker/deploy.yaml, plan Phase 12):
// refuses unless this is a deployment to production of main's tip, and every
// Woodpecker check on that commit passed. Woodpecker offers Deploy on any
// green pipeline, an old one too, and production refuses anything but main's
// tip anyway: this stops such a run before it builds and pushes images. Read
// from GitHub's public API without a token (60 calls an hour).
// GitHub's deploy.yml runs it too (the GitHub Actions plan, Part E): there the
// checks are GitHub's own, the workflow runs main's push started, read with the
// workflow's token.
//
// Usage: node ci/deploy-guard.mjs (reads Woodpecker's CI_* variables)
const repo = process.env.CI_REPO || "alirezarastineh/Portfolio-2026";
const {
  CI_PIPELINE_EVENT: event,
  CI_PIPELINE_DEPLOY_TARGET: target,
  CI_COMMIT_BRANCH: branch,
  CI_COMMIT_SHA: sha = "",
} = process.env;
// What every push to main runs. security and ci-image run when their files
// change, and count whenever they ran.
const REQUIRED = ["server", "client", "repo", "images"];
const PREFIX = "ci/woodpecker/push/";

function refuse(reason) {
  console.error(`deploy refused: ${reason}`);
  process.exit(1);
}

if (event !== "deployment") refuse(`the event is ${event}, not deployment`);
if (target !== "production") refuse(`the target is ${target}, not production`);
if (branch !== "main") refuse(`the pipeline is on ${branch}, not main`);

/** Each check's result on main's tip: Woodpecker's statuses, or GitHub's runs. */
async function woodpeckerChecks() {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits/main/status?per_page=100`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "portfolio-deploy-guard",
      },
    },
  );
  if (!response.ok) {
    refuse(`GitHub answered ${response.status} for main's status`);
  }
  const main = await response.json();
  if (main.sha !== sha) {
    refuse(
      `main is at ${main.sha.slice(0, 7)}, this pipeline is ${sha.slice(0, 7)}: deploy main's newest pipeline`,
    );
  }

  // The latest status of each context; a deployment posts none of its own.
  return new Map(
    main.statuses
      .filter((status) => status.context.startsWith(PREFIX))
      .map((status) => [status.context.slice(PREFIX.length), status.state]),
  );
}

async function githubChecks() {
  const get = async (path, what) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/${path}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "portfolio-deploy-guard",
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      },
    );
    if (!response.ok) refuse(`GitHub answered ${response.status} for ${what}`);
    return response.json();
  };
  const main = await get("commits/main", "main");
  if (main.sha !== sha) {
    refuse(
      `main is at ${main.sha.slice(0, 7)}, this run is ${sha.slice(0, 7)}: run the deploy again, on main's newest commit`,
    );
  }
  // The newest run of each workflow main's push started: a re-run replaces it.
  const { workflow_runs: runs } = await get(
    `actions/runs?head_sha=${sha}&event=push&per_page=100`,
    "the commit's runs",
  );
  const newest = new Map();
  for (const run of runs) {
    if (!newest.has(run.name) || run.id > newest.get(run.name).id)
      newest.set(run.name, run);
  }
  return new Map(
    [...newest].map(([name, run]) => [
      name,
      run.status === "completed" ? run.conclusion : run.status,
    ]),
  );
}

const checks =
  process.env.GITHUB_ACTIONS === "true"
    ? await githubChecks()
    : await woodpeckerChecks();
const missing = REQUIRED.filter((name) => !checks.has(name));
if (missing.length > 0) refuse(`no result for ${missing.join(", ")}`);
const unfinished = [...checks].filter(([, state]) => state !== "success");
if (unfinished.length > 0) {
  refuse(unfinished.map(([name, state]) => `${name} is ${state}`).join(", "));
}
console.log(
  `deploying ${sha.slice(0, 7)}, main's tip; passed: ${[...checks.keys()].sort().join(", ")}`,
);
