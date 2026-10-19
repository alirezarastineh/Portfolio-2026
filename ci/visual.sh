#!/bin/sh
# The visual project (client/e2e/visual.spec.ts) in CI (plan Phase 10): full-page
# screenshots of the public site, compared with baselines that live in CI,
# never in git. Chromium and the fonts set the pixels, so there is one set per
# tag:
# - on Woodpecker, the CI image's, in /visual/<tag>/ (the agent's
#   /var/lib/woodpecker-cache/visual);
# - on GitHub Actions (the GitHub Actions plan, Phase 5), the runner image's
#   and Playwright's, in a folder client.yml keeps in GitHub's cache, given as
#   VISUAL_ROOT and VISUAL_TAG.
# A push, a manual run or a cron run on main takes every screenshot afresh and,
# once all of them are taken, replaces the saved set. A pull request compares
# its build with the saved set. Each difference's expected, actual and diff
# images go to playwright-report/visual, which Woodpecker's reports step and
# GitHub's visual-diff artifact keep. Advisory: a visual change can be intended.
# Dry runs (pipeline 0) keep a set of their own, <tag>-dry-run, so they never
# touch main's. On GitHub the outcome also goes on the run's page, which reads
# without a login. Run from client/ after the build, as the CI image's node user:
#   sh ../ci/visual.sh
set -eu

# VISUAL_TAG where the CI names one, else the CI image's tag.
tag=${VISUAL_TAG:-${VISUAL_IMAGE:?}}
tag=${tag#*:}
set_dir=${VISUAL_ROOT:-/visual}/$tag
if [ "${CI_PIPELINE_NUMBER:?}" = 0 ]; then set_dir=$set_dir-dry-run; fi
baselines=e2e/visual-baseline/linux

# No traces: the images are the point, and a trace per page would fill the reports.
visual() { node scripts/e2e-visual.mjs --trace=off "$@"; }
# On GitHub only: a notice or a warning on the run's page, and a line in the
# job's summary.
annotate() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    echo "::$1 title=visual::$2"
    echo "- **visual**: $2" >> "$GITHUB_STEP_SUMMARY"
  fi
}

case "${CI_PIPELINE_EVENT:?}" in
  pull_request)
    if [ ! -d "$set_dir" ]; then
      echo "no baselines for $tag yet: the next push to main takes them"
      annotate notice "no baselines for $tag yet: the next push to main takes them"
      exit 0
    fi
    origin=$(cat "$set_dir/BASELINE" 2> /dev/null || echo "an unknown run")
    echo "comparing with the baselines of $origin"
    rm -rf "$baselines"
    mkdir -p "$baselines"
    cp "$set_dir"/*.png "$baselines/"
    # Beside e2e's report and results, which this run must not replace. none:
    # a missing baseline fails rather than being written. No retry: a real
    # difference fails the same way twice, and doubles the images.
    export PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/visual
    if visual --update-snapshots=none --retries=0 --output=test-results/visual; then
      echo "no visual change"
      annotate notice "no visual change against the baselines of $origin"
    else
      echo "visual changes, or pages that could not be shot: playwright-report/visual shows each one"
      differ=$(find test-results/visual -name '*-diff.png' 2> /dev/null | wc -l)
      annotate warning "$differ screenshot(s) differ from the baselines of $origin, or pages could not be shot (report only): the visual-diff artifact shows each one"
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
    # Replaced whole, and only once every screenshot was taken: after a failed
    # run the saved set stays as it was.
    status=0
    visual --update-snapshots=all --reporter=list --output=/tmp/visual-results || status=$?
    if [ "$status" -ne 0 ]; then
      annotate warning "screenshots that could not be taken, named in the step's log (report only): the saved set stays as it was"
      exit "$status"
    fi
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
    saved=$(find "$set_dir" -name '*.png' | wc -l)
    echo "saved $saved baselines to $set_dir"
    annotate notice "saved $saved baselines as the $tag set"
    ;;
  *)
    echo "nothing to do on a $CI_PIPELINE_EVENT event"
    ;;
esac
