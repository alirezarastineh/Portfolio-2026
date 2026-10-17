#!/usr/bin/env bash
# Housekeeping for the Woodpecker agent's Docker in WSL on the owner's PC, run
# by systemd/woodpecker-agent-cleanup.timer (README.md, Part 3): pipeline
# reports older than 14 days, visual baselines no run has used for 30 days,
# images.yaml's leftover tags and smoke-test stacks, unused images, build cache
# beyond 8 GB, and the dangling `wp_*` volumes that pipelines leave behind.
set -euo pipefail

REPORTS_DIR=${REPORTS_DIR:-/srv/ci-reports}
KEEP_DAYS=${KEEP_DAYS:-14}
VISUAL_DIR=${VISUAL_DIR:-/var/lib/woodpecker-cache/visual}

if [ -d "$REPORTS_DIR" ]; then
  find "$REPORTS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
fi
# One set per CI image tag (ci/visual.sh): main replaces the current one on
# every run, so a set this old belongs to an image no longer in use, a dry run
# or a run that was cut off.
if [ -d "$VISUAL_DIR" ]; then
  find "$VISUAL_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
fi

# images.yaml tags portfolio/api, portfolio/client and the smoke test's helper,
# ci-smoke, with each commit and untags them at its end, which a canceled run
# never reaches. Such a run can also leave its smoke-test stack (the compose
# project ci-<pipeline>, ci/stack-smoke.sh) up. Only while no pipeline step
# runs, so a build or a smoke test in progress keeps what it uses.
if [ -z "$(docker ps -q --filter label=wp_step)" ]; then
  docker image ls --format '{{.Repository}}:{{.Tag}}' \
    --filter 'reference=portfolio/*' --filter 'reference=ci-smoke' |
    xargs -r docker image rm >/dev/null
  for project in $(docker ps -a --filter label=com.docker.compose.project \
    --format '{{.Label "com.docker.compose.project"}}' | { grep -E '^ci-[0-9]+$' || true; } | sort -u); do
    docker ps -aq --filter "label=com.docker.compose.project=$project" | xargs -r docker rm -f >/dev/null
  done
  docker volume ls -q --filter name='^ci-[0-9]+_' | xargs -r docker volume rm >/dev/null
  docker network ls -q --filter name='^ci-[0-9]+_' | xargs -r docker network rm >/dev/null
fi
# Dangling images only: a locally built CI image keeps its tag and stays.
docker image prune -f >/dev/null
# Docker 28 renamed --keep-storage to --reserved-space; accept either engine.
# 8 GB, not more: WSL's disk lives on C:, grows and never shrinks, and C: runs
# tight; a full C: crashed WSL mid-pipeline (2026-10-15).
docker builder prune -f --reserved-space 8GB >/dev/null 2>&1 ||
  docker builder prune -f --keep-storage 8GB >/dev/null
docker volume ls -q --filter dangling=true --filter name='^wp_' | xargs -r docker volume rm >/dev/null
echo "cleaned: reports over $KEEP_DAYS days, visual sets over 30 days, leftover image tags and smoke stacks, dangling images, build cache over 8 GB, wp_* volumes"
