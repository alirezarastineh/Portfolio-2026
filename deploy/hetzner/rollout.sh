#!/usr/bin/env bash
set -euo pipefail

# Rolls production out to the images Woodpecker built and pushed for one commit
# (.woodpecker/deploy.yaml, plan Phase 12), in the house order: the pre-deploy
# backup, then the API, then the client once the API is healthy, then
# verify-deploy.sh. ci-deploy.sh runs it after fast-forwarding this checkout to
# that commit. By hand, as root, with the checkout at a commit whose images are
# on GHCR:
#   bash deploy/hetzner/rollout.sh <commit sha>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_DIR}/.env"

sha="${1:-}"
if [[ ! "${sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: rollout.sh <40-character commit sha>" >&2
  exit 2
fi
# The compose files and verify-deploy.sh come from this checkout, so it must be
# the commit the images were built from.
head="$(git -C "${REPO_DIR}" rev-parse HEAD)"
if [[ "${head}" != "${sha}" ]]; then
  echo "The checkout is at ${head:0:7}, not ${sha:0:7}." >&2
  exit 1
fi

# docker-compose.images.yml runs ghcr.io/alirezarastineh/portfolio-2026/*:<sha>.
export IMAGE_TAG="${sha}"
# The public values the client image was built with: exported, they win over
# the host's .env in compose, so the SSR container's CSP allows what its bundle
# calls.
# shellcheck source=load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_env "${SCRIPT_DIR}/client-public.env"

compose() {
  docker compose --env-file "${ENV_FILE}" \
    -f "${SCRIPT_DIR}/docker-compose.yml" \
    -f "${SCRIPT_DIR}/docker-compose.images.yml" "$@"
}

# The two images take about 2 GB, on the disk Postgres writes to (2026-10-17:
# 13 GB free, 83% used). Below 5 GB, nothing changes.
free_gb="$(df --output=avail -BG / | tail -n 1 | tr -dc '0-9')"
if (( ${free_gb:-0} < 5 )); then
  echo "Only ${free_gb} GB free on /: free some space before deploying." >&2
  exit 1
fi

echo "== backup"
bash "${SCRIPT_DIR}/backup-postgres.sh"

# Both images before any container changes: a failed pull leaves the site as
# it was.
echo "== pull ${sha:0:7}"
compose pull api client

# The API applies the migrations at boot and turns healthy once it serves. A
# failed migration crash-loops it, and the wait fails before the client is
# touched.
echo "== api"
compose up --detach --no-build --no-deps --wait --wait-timeout 300 api

echo "== client"
compose up --detach --no-build --no-deps --wait --wait-timeout 300 client

echo "== verify"
bash "${SCRIPT_DIR}/verify-deploy.sh"

# Once verified, the earlier deploys' images go: an older commit comes back
# through a new deploy (a revert), never from this host's copies. After a
# failed check they stay, for a look at what ran before.
echo "== prune"
docker image ls --format '{{.Repository}}:{{.Tag}}' \
  --filter 'reference=ghcr.io/alirezarastineh/portfolio-2026/*' |
  { grep -v ":${sha}\$" || true; } | xargs -r docker image rm || true
