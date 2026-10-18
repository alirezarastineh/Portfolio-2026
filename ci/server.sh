#!/bin/sh
# The server's checks that hold a value both CIs must agree on (the GitHub
# Actions plan, Phase 1): the unit and db tests with their coverage blobs, and
# the merged coverage with its thresholds. The workflows say when and where a
# step runs; this script says what it runs. One-liners stay in the workflows.
#   sh ci/server.sh <unit|db|coverage>
set -eu
cd "$(dirname "$0")/../server"

case "${1:-}" in
  # unit and db each write a blob report with their coverage, for `coverage` to
  # merge. Their own coverage reports stay in /tmp: run at once, the two would
  # share one coverage folder, and its clean step deletes the other's files.
  unit)
    # Nightly, the property tests take a random seed (properties.spec.ts reads
    # FC_SEED; other runs keep its fixed one). A failure prints it, and
    # FC_SEED=<seed> repeats the run locally.
    if [ "${CI_PIPELINE_EVENT:-}" = cron ]; then
      FC_SEED=$(($(od -An -N4 -tu4 /dev/urandom) % 2147483647))
      export FC_SEED
      echo "FC_SEED=${FC_SEED}: the property tests' seed for this run"
    fi
    node_modules/.bin/vitest run --project unit --reporter=default --reporter=json \
      --outputFile.json=/tmp/vitest-unit.json --reporter=blob --outputFile.blob=.vitest/blobs/unit.json \
      --coverage --coverage.reportsDirectory=/tmp/coverage --coverage.reporter=json-summary
    node ../ci/vitest-report.mjs /tmp/vitest-unit.json unit
    ;;
  # Against the CI's Postgres service, whose address the workflow gives: without
  # TEST_DATABASE_URL, pg-global-setup.ts would quietly start embedded Postgres.
  db)
    : "${TEST_DATABASE_URL:?the db specs run against a Postgres service in CI}"
    node_modules/.bin/vitest run --project db --reporter=default --reporter=json \
      --outputFile.json=/tmp/vitest-db.json --reporter=blob --outputFile.blob=.vitest/blobs/db.json \
      --coverage --coverage.reportsDirectory=/tmp/coverage --coverage.reporter=json-summary
    node ../ci/vitest-report.mjs /tmp/vitest-db.json db
    ;;
  # Coverage of unit and db together (Woodpecker plan, Phase 9), merged from
  # their blobs, with the thresholds just under the first measured figures
  # (2026-10-16: lines 90.43%, statements 88.79%, functions 91.32%, branches
  # 82.02%). Raise them by hand as tests are added; CI never writes them.
  # Branches keeps half a point: a few depend on the tests' timing, so the same
  # code measured 81.99% to 82.03% (2026-10-17), and 82 failed a run that
  # changed no code.
  coverage)
    node_modules/.bin/vitest run --merge-reports=.vitest/blobs --reporter=json \
      --outputFile.json=/tmp/vitest-merged.json --coverage \
      --coverage.thresholds.lines=90 --coverage.thresholds.statements=88 \
      --coverage.thresholds.functions=91 --coverage.thresholds.branches=81.5
    ;;
  *)
    echo "usage: sh ci/server.sh <unit|db|coverage>" >&2
    exit 2
    ;;
esac
