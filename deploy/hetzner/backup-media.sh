#!/usr/bin/env bash
set -euo pipefail

# Uploaded images live on a Docker volume, not in Postgres, so backup-postgres.sh
# only captures half the picture. A database restore without a matching media
# restore leaves media_assets rows pointing at files that no longer exist.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

BACKUP_DIR="${BACKUP_DIR:-/var/backups/portfolio-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
PROJECT="${COMPOSE_PROJECT_NAME:-portfolio}"
VOLUME="${PROJECT}_media"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE="media-${TIMESTAMP}.tar.gz"

if ! docker volume inspect "${VOLUME}" >/dev/null 2>&1; then
  echo "Volume ${VOLUME} does not exist yet — nothing to back up."
  exit 0
fi

umask 077
mkdir -p "${BACKUP_DIR}"
trap 'rm -f "${BACKUP_DIR}/${ARCHIVE}.partial"' EXIT

# Read-only mount: a backup must never be able to modify what it is backing up.
# Written as .partial and renamed on success, like the database dump.
docker run --rm \
  -v "${VOLUME}":/data:ro \
  -v "${BACKUP_DIR}":/backup \
  alpine:3 \
  sh -c "tar czf '/backup/${ARCHIVE}.partial' -C /data . && mv '/backup/${ARCHIVE}.partial' '/backup/${ARCHIVE}'"
trap - EXIT

find "${BACKUP_DIR}" -type f -name 'media-*.tar.gz' -mtime +"${RETENTION_DAYS}" -delete

echo "Backup created: ${BACKUP_DIR}/${ARCHIVE}"
