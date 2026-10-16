#!/usr/bin/env bash
# Housekeeping for the Woodpecker agent's Docker in WSL on the owner's PC, run
# by systemd/woodpecker-agent-cleanup.timer (README.md, Part 3): pipeline
# reports older than 14 days, visual baselines no run has used for 30 days,
# images.yaml's leftover tags, unused images, build cache beyond 8 GB, and the
# dangling `wp_*` volumes that pipelines leave behind.
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

# images.yaml tags portfolio/api and portfolio/client with each commit and
# untags them at its end, which a canceled run never reaches. Only while no
# pipeline step runs, so a build in progress keeps its tags.
if [ -z "$(docker ps -q --filter label=wp_step)" ]; then
  docker image ls --format '{{.Repository}}:{{.Tag}}' --filter 'reference=portfolio/*' |
    xargs -r docker image rm >/dev/null
fi
# Dangling images only: a locally built CI image keeps its tag and stays.
docker image prune -f >/dev/null
# Docker 28 renamed --keep-storage to --reserved-space; accept either engine.
# 8 GB, not more: WSL's disk lives on C:, grows and never shrinks, and C: runs
# tight; a full C: crashed WSL mid-pipeline (2026-10-15).
docker builder prune -f --reserved-space 8GB >/dev/null 2>&1 ||
  docker builder prune -f --keep-storage 8GB >/dev/null
docker volume ls -q --filter dangling=true --filter name='^wp_' | xargs -r docker volume rm >/dev/null
echo "cleaned: reports over $KEEP_DAYS days, visual sets over 30 days, leftover image tags, dangling images, build cache over 8 GB, wp_* volumes"
