# CI: Woodpecker and GitHub Actions

Two CIs run the same checks on every push to `main` and every pull request:

- **Woodpecker** (`.woodpecker/`): its server runs on the production host and its agent on the
  owner's PC (`deploy/woodpecker/README.md`). It gates the work, deploys `main`, and emails
  failures through Resend.
- **GitHub Actions** runs the same checks on GitHub's runners (`.github/workflows/`), whether the
  PC is on or not, and emails failures through GitHub's own notifications.

Woodpecker alone deploys. `ci/deploy-guard.mjs` reads only Woodpecker's statuses
(`ci/woodpecker/push/*`) from `main`'s combined status. GitHub's results are check runs, which
that status leaves out, so they never block or allow a deploy.

## One set of checks

Every step whose command or value both CIs must agree on runs a script in this folder:
`ci/{server,client,repo,images,security,weekly}.sh <step>`, `ci/code-health.sh`, and the node
scripts beside them. A workflow says when and where a step runs; the script says what it runs.
One-liners (`eslint .`, the typechecks) stay inline in both.

| Woodpecker | GitHub | GitHub's jobs (parallel unless →) | Runs on |
|---|---|---|---|
| `server.yaml` | `server.yml` | `checks` · `tests` (unit, db on `postgres:17-alpine`, coverage) | push to `main`, PRs on its paths, the nightly |
| `client.yaml` | `client.yml` | `checks` · `unit` · `build` → `e2e` · `lighthouse` · `visual` · `cross-browser` (nightly) | push to `main`, PRs on its paths, the nightly |
| `repo.yaml` | `repo.yml` | `lint`: the infrastructure linters, actionlint, zizmor, the parity check | push to `main`, every PR, the nightly |
| `images.yaml` | `images.yml` | `images`: both images, their SBOMs, Trivy, the stack smoke test | push to `main`, PRs on its paths, the nightly |
| `security.yaml` | `security.yml` | `security`: audit, licences, osv-scanner, semgrep | lockfile or check changes, the nightly |
| the `nightly` cron | `nightly.yml` | calls the five above with `nightly: true` | daily |
| `weekly.yaml` | `weekly.yml` | `weekly`: gitleaks over the history, `pnpm outdated`, Woodpecker's version, the action pins, `inactivity` (GitHub) | Mondays |
| `prod-smoke.yaml` | `prod-smoke.yml` | `live`: read-only requests to the live site | daily |
| `ci-image.yaml`, `deploy.yaml` | none | Woodpecker's CI image and the deploy | |

The scripts read Woodpecker's variable names (`CI_PIPELINE_EVENT`, `CI_COMMIT_BRANCH`,
`CI_COMMIT_SHA`, `CI_PIPELINE_NUMBER`); each GitHub workflow sets them from its own context, a
nightly call as `cron` and a manual run as `manual`. Paths that differ between the CIs come from
the environment, with Woodpecker's as the default (`PNPM_STORE`, `TRIVY_CACHE`, `VISUAL_ROOT`).

**Blocking and report only.** These only report, in both: knip, cycles, osv-scanner, semgrep,
bundle-size, visual, cross-browser and `pnpm outdated`. A report-only step is marked on its own and
leaves the workflow green (`failure: ignore` on Woodpecker, `continue-on-error` on GitHub).
Everything else blocks.

**The parity check.** `ci/ci-parity.mjs` runs in both CIs' `repo` workflow and fails when the two
definitions drift:
- a check step (a lower-case step name) is in one twin only, apart from each CI's short list of its
  own: Woodpecker's `owner`, `wait-pg`, `pw-version`, `reports`, `untag` and `email`, GitHub's
  `inactivity`;
- an image both CIs name is pinned to a different tag or digest;
- a GitHub action isn't pinned to a full commit SHA with its version in a comment;
- the twins' pull request path filters differ, each CI's own files aside.

**Adding a check:** put the command in the area's script, then a step of the same name in both
twins, with the same image pin. The parity check fails until both have it.

## GitHub's side

- **Runners:** every job runs on `ubuntu-24.04`, pinned: `ubuntu-latest` moves to 26.04, and the
  runner image sets the visual baselines' pixels. Moving is a change of its own, with a new set.
- **Results without a login:** job logs need one, annotations don't. The scripts put their results
  on the run's page when GitHub's variables are set: test counts, coverage, Lighthouse's gates, the
  bundle size, the visual outcome, the smoke test's checks, each CRITICAL, the audit and licence
  counts. Woodpecker's output stays as it is.
- **Caches** (10 GB a repository; an entry unused for 7 days goes): the pnpm stores, Playwright's
  browsers per version, the visual baselines and the bundle-size baseline.
  - **Visual baselines:** a push to `main` or a nightly saves the set as
    `visual-<runner image>-pw<Playwright version>-<run id>-<attempt>`; a pull request compares
    against the newest and uploads `visual-diff` when something differs. With no set (after a quiet
    week, or a new runner image or Playwright), the comparison says so and passes.
  - **Bundle size:** a push to `main` saves `bundle-size-<run id>-<attempt>`; the others compare
    against the newest.
- **Artifacts,** kept 14 days: `server-coverage`, `client-coverage`, `e2e-report`, `lighthouse`,
  `visual-diff`, `cross-browser-<browser>`, `sbom`. `client-dist` carries the build between jobs for
  a day.
- **Settings** (Settings → Actions → General): fork pull requests need approval for every external
  contributor; the workflow token reads the contents only and can't create or approve pull
  requests; artifacts and logs are kept 14 days; every action must be pinned to a full-length commit
  SHA.

## Schedules

| Run | Woodpecker (Settings → Crons) | GitHub (UTC) |
|---|---|---|
| nightly | daily 02:30 local | daily 01:17 |
| weekly | Mondays 09:00 local | Mondays 05:43 |
| prod-smoke | daily 09:00 local | daily 18:43, about 12 hours later |

- Woodpecker's runs wait in its queue while the PC is off and run once it's back.
- GitHub runs schedules from `main` only, on odd minutes, since the top of the hour is the busiest;
  under heavy load it starts them late, or drops one.
- **After 60 days without activity in the repository, GitHub switches the schedules off,** with only
  a banner on the Actions tab. The weekly's `inactivity` step fails once the newest commit is 45 days
  old, so its email comes first. A commit is the remedy, never one from CI. Switched off already:
  Actions → `nightly`, `weekly`, `prod-smoke` → **Enable workflow**, each of the three (the nightly
  calls the other five).
- Every scheduled workflow also runs by hand: Actions → the workflow → **Run workflow**, on `main`.
  `weekly` takes `inactivity_days`; `prod-smoke` takes `notify_test`.

## Failure email

- **Woodpecker:** every workflow's last step, `email` (`ci/notify.mjs`), sends one through Resend
  when one of its steps failed, for pushes to `main`, crons and deploys
  (`deploy/woodpecker/README.md`, "Schedules and failure email").
- **GitHub:** its own notifications. Settings → Notifications → System → Actions: **Email**, and
  **Only notify for failed workflows**. A scheduled run notifies whoever last changed its cron line;
  a manual run, whoever started it.
- **The test,** in either: a manual `prod-smoke` with `notify_test` ticked (GitHub) or the variable
  `NOTIFY_TEST=1` (Woodpecker) fails its first step on purpose, so one email arrives.

## Action pins

Every action in `.github/workflows` is pinned to a full commit SHA with its version in a comment,
`uses: actions/checkout@<sha> # v7.0.1`, as every image is pinned by digest. The pin is the newest
release that has been out for 14 days, the age this repository waits for before taking any.

- **The weekly's `action-pins` step** (`ci/action-pins.mjs`, in both CIs) fails when a SHA isn't its
  version's commit, and once a newer release, a new major included, has been out for 14 days: the
  weekly email is the cue. A new major may need changes to the workflows that use it.
- **Moving a pin:**
  1. Read the release notes between the two versions.
  2. Resolve the new tag's commit in the action's own repository:
     `GET https://api.github.com/repos/<owner>/<action>/commits/<tag>` (its `sha`).
  3. Replace the SHA and the comment in every workflow that uses the action, in one commit.
  4. zizmor and the parity check (`repo`) check the form on the push; the next weekly, or a manual
     one, checks the commit.
- No Dependabot: the weekly check is the reminder, and a person moves the pin.
