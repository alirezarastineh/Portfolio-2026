#!/usr/bin/env bash
set -euo pipefail

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

BACKUP_DIR="${BACKUP_DIR:-/var/backups/portfolio-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"

# Dumps hold password hashes and TOTP secrets: readable by root only.
umask 077
mkdir -p "${BACKUP_DIR}"

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

PARTIAL_FILE=""
trap 'rm -f "${PARTIAL_FILE}"' EXIT

# Written under a temporary name and renamed only once complete and verified,
# so a failed or interrupted run never leaves a truncated file that looks like
# a good backup (and that retention would otherwise keep).
dump_database() {
  local database="$1"
  local dump_file="${BACKUP_DIR}/${database}-${TIMESTAMP}.dump"
  PARTIAL_FILE="${dump_file}.partial"

  # Custom format is already compressed; gzipping it again only costs CPU.
  compose exec -T db \
    pg_dump --format=custom --no-owner --no-privileges \
    -U "${POSTGRES_USER}" -d "${database}" > "${PARTIAL_FILE}"

  # Cheap integrity check: pg_restore must be able to read the table of contents.
  compose exec -T db pg_restore --list > /dev/null < "${PARTIAL_FILE}"

  mv "${PARTIAL_FILE}" "${dump_file}"
  PARTIAL_FILE=""
  echo "Backup created: ${dump_file}"
}

dump_database "${POSTGRES_DB}"

# Umami's analytics live in their own database on the same server.
if compose exec -T db psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
  "select 1 from pg_database where datname = 'umami'" | grep -q 1; then
  dump_database umami
fi

trap - EXIT

# `*.dump.gz` covers backups made before the gzip step was dropped.
find "${BACKUP_DIR}" -type f \( -name "*.dump" -o -name "*.dump.gz" \) \
  -mtime +"${RETENTION_DAYS}" -delete
