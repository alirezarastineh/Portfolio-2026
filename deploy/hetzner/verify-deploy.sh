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

CLIENT="http://127.0.0.1:${CLIENT_HOST_PORT}"
API="http://127.0.0.1:${API_HOST_PORT}"
FAILURES=0

pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; FAILURES=$((FAILURES + 1)); }

# Runs a check without letting `set -e` abort the whole report on the first
# failure — the point is to see everything that is wrong in one run.
check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "${label}"; else fail "${label}"; fi
}

echo "== containers =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "== database =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "select now() as server_time, current_database() as database_name;"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "select locale, version_id, published_at from content_pointers order by locale;"

echo "== services =="
check "client responds" curl -fsSI "${CLIENT}"
check "api /health" curl -fsS "${API}/health"
check "pgadmin responds" curl -fsSI "http://127.0.0.1:${PGADMIN_HOST_PORT}"

echo "== content read path =="
check "api serves published en content" curl -fsS "${API}/v1/content/en"
check "api serves published de content" curl -fsS "${API}/v1/content/de"
check "api rejects an unknown locale" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/v1/content/fr')\" = 400 ]"

# The one that matters: SSR must render what the database holds. If it does
# not, either prerendering came back or the BFF cannot reach the API.
HEADLINE="$(curl -fsS "${API}/v1/content/en" | sed -n 's/.*"heroHeadline":"\([^"]*\)".*/\1/p')"
if [[ -n "${HEADLINE}" ]] && curl -fsS "${CLIENT}/" | grep -qF "${HEADLINE}"; then
  pass "SSR renders the published hero headline"
else
  fail "SSR renders the published hero headline (got '${HEADLINE}')"
fi

check "BFF is serving live content, not the bundled fallback" \
  bash -c "! curl -fsSI '${CLIENT}/api/v1/content/en' | grep -qi 'x-content-source: fallback'"

check "prerendered index.html is absent (edits must not need a rebuild)" \
  bash -c "! docker compose --env-file '${ENV_FILE}' -f '${COMPOSE_FILE}' exec -T client test -f dist/analog/public/index.html"

echo "== crawler surface =="
check "robots.txt disallows /admin" bash -c "curl -fsS '${CLIENT}/robots.txt' | grep -q 'Disallow: /admin'"
check "sitemap.xml is served" bash -c "curl -fsS '${CLIENT}/sitemap.xml' | grep -q '<urlset'"

echo "== auth boundary =="
check "admin is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/status')\" = 401 ]"
check "publish refuses a foreign Origin" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' '${API}/admin/publish')\" = 403 ]"

echo "== media =="
check "media route rejects traversal" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --path-as-is '${API}/media/../../etc/passwd')\" = 404 ]"
MEDIA_OWNER="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api stat -c '%U' /data/media 2>/dev/null || true)"
if [[ "${MEDIA_OWNER}" == "node" ]]; then
  pass "media volume is owned by node (uploads will not EACCES)"
else
  fail "media volume owner is '${MEDIA_OWNER}', expected 'node' — see DEPLOYMENT.md, Media ownership"
fi

echo
if [[ "${FAILURES}" -gt 0 ]]; then
  echo "Verification FAILED: ${FAILURES} check(s)."
  exit 1
fi
echo "Verification successful."
