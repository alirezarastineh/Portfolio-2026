#!/bin/sh
# Copies a workflow's reports to /srv/ci-reports/<pipeline>/<workflow>/ on the
# agent (WSL on the owner's PC) and prints where Windows opens them (plan
# Phase 5). A workflow's last step runs it as root, pass or fail, from the
# package's directory, with the report folders as arguments:
#   sh ../ci/save-reports.sh playwright-report test-results .lighthouseci
# agent-cleanup.sh deletes reports after 14 days. A dry run's pipeline is 0.
set -eu

dest="/srv/ci-reports/${CI_PIPELINE_NUMBER:?}/${CI_WORKFLOW_NAME:?}"
# The same folder from Windows: the agent's WSL distro is named Ubuntu.
windows="\\\\wsl.localhost\\Ubuntu$(printf '%s' "$dest" | sed 's|/|\\|g')"

# Every dry run is pipeline 0.
rm -rf "$dest"
mkdir -p "$dest"
for dir in "$@"; do
  if [ -d "$dir" ]; then
    cp -R "$dir" "$dest/"
    printf 'saved %s, %s\n' "$dir" "$(du -sh "$dest/$(basename "$dir")" | cut -f1)"
  else
    printf 'no %s: the step that writes it did not run\n' "$dir"
  fi
done

printf '\n%s\n' "$windows"
if [ -f "$dest/playwright-report/index.html" ]; then
  # Opened as a file, the report shows each failure but not its trace: the
  # trace viewer needs it served.
  printf 'e2e report and traces, from client/: npx playwright show-report "%s\\playwright-report"\n' "$windows"
fi
# A pull request's screenshots against main's (plan Phase 10): no traces, so
# the file opens directly, each difference with its expected, actual and diff.
if [ -f "$dest/playwright-report/visual/index.html" ]; then
  printf 'visual changes: %s\\playwright-report\\visual\\index.html\n' "$windows"
fi
if [ -f "$dest/playwright-report/cross-browser/index.html" ]; then
  printf 'Firefox and WebKit, from client/: npx playwright show-report "%s\\playwright-report\\cross-browser"\n' "$windows"
fi
if [ -d "$dest/.lighthouseci/reports" ]; then
  printf 'Lighthouse: the .html files in %s\\.lighthouseci\\reports\n' "$windows"
fi
if [ -f "$dest/coverage/index.html" ]; then
  printf 'coverage: %s\\coverage\\index.html\n' "$windows"
fi
