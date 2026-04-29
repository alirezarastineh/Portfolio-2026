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

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/portfolio-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
RAW_FILE="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  pg_dump --format=custom --no-owner --no-privileges \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" > "${RAW_FILE}"

gzip -f "${RAW_FILE}"

find "${BACKUP_DIR}" -type f -name "*.dump.gz" -mtime +"${RETENTION_DAYS}" -delete

echo "Backup created: ${RAW_FILE}.gz"
