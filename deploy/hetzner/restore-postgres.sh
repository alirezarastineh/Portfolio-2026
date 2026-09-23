#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--yes] /path/to/backup.dump[.gz]"
  exit 1
}

ASSUME_YES=0
if [[ "${1:-}" == "--yes" ]]; then
  ASSUME_YES=1
  shift
fi
[[ $# -eq 1 ]] || usage

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_DIR}/deploy/hetzner/docker-compose.yml"
ENV_FILE="${REPO_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}."
  exit 1
fi

# Read as data, the way docker compose reads it (see load-env.sh).
# shellcheck source=load-env.sh
source "${SCRIPT_DIR}/load-env.sh"
load_env "${ENV_FILE}"

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

if [[ "${ASSUME_YES}" -ne 1 ]]; then
  read -r -p "This REPLACES the live database ${POSTGRES_DB} with $(basename "${BACKUP_FILE}"). Continue? [y/N] " reply
  if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# Stop the API so nothing writes mid-restore, and always start it again —
# even if the restore fails, the old data is better served than none.
compose stop api
trap 'compose start api' EXIT

restore() {
  compose exec -T db \
    pg_restore --clean --if-exists --no-owner --no-privileges \
    -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"
}

# `.dump.gz` files are from before backups dropped the redundant gzip step.
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gzip -dc "${BACKUP_FILE}" | restore
else
  restore < "${BACKUP_FILE}"
fi

echo "Restore complete. Restore the matching media archive too (restore-media.sh)."
