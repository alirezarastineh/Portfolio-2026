#!/bin/sh
# The weekly checks (Woodpecker plan, Phase 13), from the repo root.
#   sh ci/weekly.sh <history|outdated>
set -eu
cd "$(dirname "$0")/.."

case "${1:-}" in
  # gitleaks over the whole history: the working tree's scan runs on every
  # push, and a secret committed once lives on in git after it is removed. The
  # rules and waivers are the tree scan's (.gitleaks.toml), matched by value and
  # file, so they hold across the history too. Without a repository gitleaks
  # scans 0 commits, finds no leaks and exits 0: the whole history must be there
  # first.
  history)
    test "$(git rev-parse --is-shallow-repository)" = false
    echo "$(git rev-list --count HEAD) commits"
    gitleaks git --config .gitleaks.toml --redact --no-banner --verbose .
    ;;
  # Report only, exit 0: there is nearly always something. "Current" reads
  # missing, since nothing is installed here; compare "Wanted" (the lockfile)
  # with "Latest".
  outdated)
    for p in server client; do
      echo "== $p"
      (cd "$p" && pnpm outdated) || true
    done
    ;;
  *)
    echo "usage: sh ci/weekly.sh <history|outdated>" >&2
    exit 2
    ;;
esac
