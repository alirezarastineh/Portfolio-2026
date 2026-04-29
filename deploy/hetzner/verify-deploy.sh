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
: "${CLIENT_HOST_PORT:?CLIENT_HOST_PORT is required}"
: "${API_HOST_PORT:?API_HOST_PORT is required}"
: "${PGADMIN_HOST_PORT:?PGADMIN_HOST_PORT is required}"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "select now() as server_time, current_database() as database_name;"

curl -fsSI "http://127.0.0.1:${CLIENT_HOST_PORT}" >/dev/null
curl -fsSI "http://127.0.0.1:${API_HOST_PORT}/health" >/dev/null
curl -fsSI "http://127.0.0.1:${PGADMIN_HOST_PORT}" >/dev/null

echo "Verification successful."
