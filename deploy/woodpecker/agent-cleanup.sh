#!/usr/bin/env bash
# Housekeeping for the Woodpecker agent's Docker in WSL on the owner's PC, run
# by systemd/woodpecker-agent-cleanup.timer (README.md, Part 3): pipeline
# reports older than 14 days, images.yaml's leftover tags, unused images, build
# cache beyond 20 GB, and the dangling `wp_*` volumes that pipelines leave
# behind.
set -euo pipefail

REPORTS_DIR=${REPORTS_DIR:-/srv/ci-reports}
KEEP_DAYS=${KEEP_DAYS:-14}

if [ -d "$REPORTS_DIR" ]; then
  find "$REPORTS_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
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
docker builder prune -f --reserved-space 20GB >/dev/null 2>&1 ||
  docker builder prune -f --keep-storage 20GB >/dev/null
docker volume ls -q --filter dangling=true --filter name='^wp_' | xargs -r docker volume rm >/dev/null
echo "cleaned: reports over $KEEP_DAYS days, leftover image tags, dangling images, build cache over 20 GB, wp_* volumes"
