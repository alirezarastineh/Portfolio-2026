#!/bin/sh
# The client's checks that hold a value both CIs must agree on (the GitHub
# Actions plan, Phase 1). The workflows say when and where a step runs; this
# script says what it runs. One-liners stay in the workflows.
#   sh ci/client.sh <unit|e2e|lighthouse>
#   sh ci/client.sh cross-browser [firefox|webkit]
set -eu
cd "$(dirname "$0")/../client"

# On GitHub Actions (Phase 4), vitest's own reporter also puts each failed test
# on the run's page; vitest adds it by itself only when no reporter is named.
github=""
if [ "${GITHUB_ACTIONS:-}" = true ]; then github=--reporter=github-actions; fi

case "${1:-}" in
  # With coverage (Woodpecker plan, Phase 9). The thresholds sit just under the
  # first measured figures (2026-10-16: lines 28.14%, statements 28.13%,
  # functions 28.21%, branches 32.01%); raise them by hand as tests are added,
  # CI never writes them.
  # 30 s a test, as the server's db project has: beside the build and the
  # server's checks, with coverage on, a file's first test pays for compiling
  # its components, and took up to 5.8 s against vitest's 5 s default (#40).
  # Local runs keep the default.
  unit)
    status=0
    node_modules/.bin/vitest run --reporter=default ${github:+"$github"} --reporter=json \
      --outputFile.json=/tmp/vitest-client.json --testTimeout=30000 --coverage \
      --coverage.thresholds.lines=28 --coverage.thresholds.statements=28 \
      --coverage.thresholds.functions=28 --coverage.thresholds.branches=32 || status=$?
    # On GitHub, the four figures also go on the run's page, pass or fail. A
    # failed test leaves none (vitest's reportOnFailure is off), so a missing
    # summary only counts after a clean run.
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] &&
      { [ "$status" -eq 0 ] || [ -f coverage/coverage-summary.json ]; }; then
      node ../ci/vitest-report.mjs --coverage coverage/coverage-summary.json coverage
    fi
    if [ "$status" -ne 0 ]; then exit "$status"; fi
    node ../ci/vitest-report.mjs /tmp/vitest-client.json client
    ;;
  # 253 tests, axe included, against the build and a fixture API. CI turns on
  # retries and forbidOnly. Two workers: Woodpecker's agent shares the PC, and
  # three were no faster beside the server's checks (197 s against 204 s) but
  # slowed them.
  e2e)
    node_modules/.bin/playwright test --workers=2
    ;;
  # On the Chromium that e2e drives, Playwright's own build.
  lighthouse)
    CHROME_PATH=$(node -p "require('@playwright/test').chromium.executablePath()")
    export CHROME_PATH
    node scripts/lhci.mjs
    ;;
  # The desktop suite in Firefox and WebKit (Woodpecker plan, Phase 10), with
  # its report and results beside e2e's: the browser given, or both. Report
  # only: on GitHub (Phase 5) a failure also becomes a warning on the run's page
  # and a line in the job's summary.
  cross-browser)
    browsers=${2:-firefox and webkit}
    if [ -n "${2:-}" ]; then
      set -- "--project=$2"
    else
      set -- --project=firefox --project=webkit
    fi
    status=0
    E2E_CROSS_BROWSER=1 PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/cross-browser \
      node_modules/.bin/playwright test "$@" --workers=2 --output=test-results/cross-browser ||
      status=$?
    if [ "$status" -ne 0 ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo "::warning title=cross-browser::$browsers exited $status (report only): the failed tests are annotated, and the report is an artifact"
      echo "- **cross-browser** ($browsers) exited $status (report only)" >> "$GITHUB_STEP_SUMMARY"
    fi
    exit "$status"
    ;;
  *)
    echo "usage: sh ci/client.sh <unit|e2e|lighthouse|cross-browser [firefox|webkit]>" >&2
    exit 2
    ;;
esac
