#!/bin/sh
# The admin redesign's tools (plan 5) on the build in client/dist, one after another, each serving
# it on a port of its own, every admin and auth call answered in the browser. Report only: plan 5
# calls them signals. Each tool's output goes to $ADMIN_TOOLS_OUT (an artifact), its last lines to
# the run's summary, and a failed tool to a warning. With $ADMIN_SHOTS_BEFORE (last night's admin
# screenshots) it also pixel-compares tonight's with them. The detector needs Impeccable's engine
# at $IMPECCABLE_BIN.
# Usage, from anywhere: sh ci/admin-tools/run.sh
set -u
out=${ADMIN_TOOLS_OUT:?"set ADMIN_TOOLS_OUT"}
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
failed=""

step() {
  name=$1
  shift
  echo "== $name $(date +%T)"
  status=0
  (cd "$here" && "$@") > "$out/$name.txt" 2>&1 || status=$?
  if [ "$status" -ne 0 ]; then failed="$failed $name"; fi
  grep -v -e DEP0190 -e trace-deprecation "$out/$name.txt" | tail -n 3
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      printf '#### %s (exit %s)\n\n```\n' "$name" "$status"
      grep -v -e DEP0190 -e trace-deprecation "$out/$name.txt" | tail -n 14
      printf '```\n\n'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### admin-tools\n\nEvery output is in the admin-tools artifact.\n\n' \
    >> "$GITHUB_STEP_SUMMARY"
fi
step fixtures node gen-fixtures.mjs
step detector node detector-admin.mjs nightly
step matrix node matrix.mjs
step clipped node clipped.mjs
step probe node probe.mjs
step probe2 node probe2.mjs
step keyboard-dark-1280 node keyboard-walk.mjs dark 1280
step keyboard-light-390 node keyboard-walk.mjs light 390
step vercel-sweep node vercel-sweep.mjs
step view-chunks node view-chunks.mjs
step tasks node tasks.mjs
step sr-audit node sr-audit.mjs
step admin-shots node admin-shots.mjs
if [ -d "${ADMIN_SHOTS_BEFORE:-}" ] && [ -n "$(ls "${ADMIN_SHOTS_BEFORE}" 2> /dev/null)" ]; then
  step pixdiff node pixdiff.mjs "$ADMIN_SHOTS_BEFORE" "$out/admin-shots"
fi

if [ -n "$failed" ]; then
  echo "failed:$failed"
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    echo "::warning title=admin-tools::failed:$failed (report only; see the admin-tools artifact)"
  fi
  exit 1
fi
