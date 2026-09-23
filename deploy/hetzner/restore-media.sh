#!/usr/bin/env bash
set -euo pipefail

# Usage: restore-media.sh /var/backups/portfolio-postgres/media-20260101-120000.tar.gz
#
# Restore this alongside a database restore. Restoring only one of the two
# leaves media_assets rows and files on disk out of step — the admin dashboard
# surfaces that drift via /admin/media-reconcile.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_DIR}/deploy/hetzner/docker-compose.yml"
ENV_FILE="${REPO_DIR}/.env"
ARCHIVE="${1:-}"

if [[ -z "${ARCHIVE}" || ! -f "${ARCHIVE}" ]]; then
  echo "Usage: $0 <media-archive.tar.gz>"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}."
  exit 1
fi

# Read as data, the way docker compose reads it (see load-env.sh).
# shellcheck source=load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_env "${ENV_FILE}"

PROJECT="${COMPOSE_PROJECT_NAME:-portfolio}"
VOLUME="${PROJECT}_media"
ARCHIVE_DIR="$(cd "$(dirname "${ARCHIVE}")" && pwd)"
ARCHIVE_NAME="$(basename "${ARCHIVE}")"

read -r -p "This REPLACES everything in volume ${VOLUME}. Continue? [y/N] " reply
if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

# Stop the API first: restoring underneath a running container risks serving a
# half-extracted file.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop api || true

docker volume create "${VOLUME}" >/dev/null

# Start the API again even if the restore fails.
trap 'docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" start api' EXIT

# `find -delete` empties the volume including dotfiles, which a `/data/*` glob
# misses. 1000:1000 is the `node` user the API image runs as.
docker run --rm \
  -v "${VOLUME}":/data \
  -v "${ARCHIVE_DIR}":/backup:ro \
  alpine:3 \
  sh -c "find /data -mindepth 1 -delete && tar xzf '/backup/${ARCHIVE_NAME}' -C /data && mkdir -p /data/tmp && chown -R 1000:1000 /data"

echo "Restored ${ARCHIVE_NAME} into ${VOLUME}."
echo "Check /admin for reconcile warnings if the database was restored separately."
