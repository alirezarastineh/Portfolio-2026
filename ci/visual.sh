#!/bin/sh
# The visual project (client/e2e/visual.spec.ts) in CI (plan Phase 10): full-page
# screenshots of the public site, compared with baselines that live on the
# agent, never in git. Chromium and the fonts set the pixels, so there is one
# set per CI image tag, in /visual/<tag>/ (the agent's
# /var/lib/woodpecker-cache/visual).
# - A push, a manual run or a cron run on main takes every screenshot afresh
#   and, once all of them are taken, replaces the saved set.
# - A pull request compares its build with the saved set. Each difference's
#   expected, actual and diff images go to playwright-report/visual, which the
#   reports step saves. Advisory: a visual change can be intended.
# Dry runs (pipeline 0) keep a set of their own, <tag>-dry-run, so they never
# touch main's. Run from client/ after the build, as the CI image's node user:
#   sh ../ci/visual.sh
set -eu

tag=${VISUAL_IMAGE:?}
tag=${tag#*:}
set_dir=/visual/$tag
if [ "${CI_PIPELINE_NUMBER:?}" = 0 ]; then set_dir=$set_dir-dry-run; fi
baselines=e2e/visual-baseline/linux

# No traces: the images are the point, and a trace per page would fill the reports.
visual() { node scripts/e2e-visual.mjs --trace=off "$@"; }

case "${CI_PIPELINE_EVENT:?}" in
  pull_request)
    if [ ! -d "$set_dir" ]; then
      echo "no baselines for $tag yet: the next push to main takes them"
      exit 0
    fi
    echo "comparing with the baselines of $(cat "$set_dir/BASELINE" 2> /dev/null || echo "an unknown run")"
    rm -rf "$baselines"
    mkdir -p "$baselines"
    cp "$set_dir"/*.png "$baselines/"
    # Beside e2e's report and results, which this run must not replace. none:
    # a missing baseline fails rather than being written. No retry: a real
    # difference fails the same way twice, and doubles the images.
    export PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/visual
    if visual --update-snapshots=none --retries=0 --output=test-results/visual; then
      echo "no visual change"
    else
      echo "visual changes, or pages that could not be shot: playwright-report/visual shows each one"
      exit 1
    fi
    ;;
  push | manual | cron)
    if [ "${CI_COMMIT_BRANCH:-}" != main ]; then
      echo "baselines come from main only"
      exit 0
    fi
    rm -rf "$baselines"
    # Every screenshot rewritten. Neither the HTML report nor the actual
    # images reach the reports: they would add the whole set to every main run.
    visual --update-snapshots=all --reporter=list --output=/tmp/visual-results
    # Replaced whole, and only once every screenshot was taken: set -e stops
    # here after a failed run, and the saved set stays as it was.
    rm -rf "$set_dir.new" "$set_dir.old"
    mkdir -p "$set_dir.new"
    cp "$baselines"/*.png "$set_dir.new/"
    printf 'main %s (pipeline %s, %s)\n' "${CI_COMMIT_SHA:?}" "$CI_PIPELINE_NUMBER" \
      "$(date -u +%FT%TZ)" > "$set_dir.new/BASELINE"
    # Two renames, so a pull request reading the set at the same time almost
    # never finds it gone.
    if [ -d "$set_dir" ]; then mv "$set_dir" "$set_dir.old"; fi
    mv "$set_dir.new" "$set_dir"
    rm -rf "$set_dir.old"
    echo "saved $(find "$set_dir" -name '*.png' | wc -l) baselines to $set_dir"
    ;;
  *)
    echo "nothing to do on a $CI_PIPELINE_EVENT event"
    ;;
esac
