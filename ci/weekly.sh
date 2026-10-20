#!/bin/sh
# The weekly checks (Woodpecker plan, Phase 13), from the repo root. GitHub's
# weekly runs them too, plus `inactivity` (the GitHub Actions plan, Phase 8).
# On GitHub Actions, a step's result also goes on the run's page, which reads
# without a login: gitleaks' image gets GITHUB_ACTIONS there and nothing else
# of the runner's, so `history` makes an annotation alone; the steps on the
# runner add a line to the job's summary.
#   sh ci/weekly.sh <history|outdated|inactivity>
set -eu
cd "$(dirname "$0")/.."

github() { # level, message
  if [ "${GITHUB_ACTIONS:-}" != true ]; then return 0; fi
  echo "::$1 title=$step::$2"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "- **$step**: $2" >> "$GITHUB_STEP_SUMMARY"; fi
}

step=${1:-}
case "$step" in
  # gitleaks over the whole history: the working tree's scan runs on every
  # push, and a secret committed once lives on in git after it is removed. The
  # rules and waivers are the tree scan's (.gitleaks.toml), matched by value and
  # file, so they hold across the history too. Without a repository gitleaks
  # scans 0 commits, finds no leaks and exits 0: the whole history must be there
  # first.
  history)
    if [ "$(git rev-parse --is-shallow-repository)" != false ]; then
      github error "not the whole history: a shallow clone, or no repository"
      exit 1
    fi
    commits=$(git rev-list --count HEAD)
    echo "$commits commits"
    status=0
    gitleaks git --config .gitleaks.toml --redact --no-banner --verbose . || status=$?
    if [ "$status" -eq 0 ]; then
      github notice "$commits commits, no leaks found"
    else
      github error "gitleaks exited $status over $commits commits: its step's log lists the findings, redacted"
    fi
    exit "$status"
    ;;
  # Report only, exit 0: there is nearly always something. "Current" reads
  # missing, since nothing is installed here; compare "Wanted" (the lockfile)
  # with "Latest". On GitHub, each package's count goes on the run's page too:
  # the dependencies whose latest release isn't the lockfile's, since every
  # dependency is listed.
  outdated)
    for p in server client; do
      echo "== $p"
      (cd "$p" && pnpm outdated) || true
      if [ "${GITHUB_ACTIONS:-}" = true ]; then
        if count=$( (cd "$p" && pnpm outdated --format json 2> /dev/null) | node -e '
          let s = "";
          process.stdin.on("data", (d) => (s += d)).on("end", () => {
            const report = JSON.parse(s);
            if (report.error) throw new Error(report.error.message);
            const all = Object.values(report);
            const newer = all.filter((d) => d.latest !== d.wanted);
            console.log(newer.length + " of " + all.length);
          });'); then
          github notice "$p: $count dependencies have a newer release (report only): its step's log has the table"
        else
          github warning "$p: pnpm outdated gave no report"
        fi
      fi
    done
    ;;
  # GitHub Actions only: GitHub switches a repository's schedules off after 60
  # days without activity, and says so only on the Actions tab. So this fails
  # once the newest commit is INACTIVITY_DAYS old (45 unless a manual run sets
  # it; 0 for the red), and the weekly's email comes while they still run. The
  # remedy is a commit, or re-enabling them (ci/README.md, "Schedules"); CI
  # never commits.
  inactivity)
    limit=${INACTIVITY_DAYS:-45}
    age=$((($(date +%s) - $(git log -1 --format=%ct)) / 86400))
    if [ "$age" -ge "$limit" ]; then
      echo "FAIL the newest commit is $age days old, and the limit is $limit" >&2
      github error "the newest commit is $age days old, and the limit is $limit: GitHub switches the schedules off at 60 days without activity (ci/README.md, \"Schedules\")"
      exit 1
    fi
    echo "the newest commit is $age days old; the limit is $limit"
    github notice "the newest commit is $age days old; the limit is $limit"
    ;;
  *)
    echo "usage: sh ci/weekly.sh <history|outdated|inactivity>" >&2
    exit 2
    ;;
esac
