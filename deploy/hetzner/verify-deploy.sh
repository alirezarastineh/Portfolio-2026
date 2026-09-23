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

# Runs one scalar query; empty output when it fails.
db_value() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T db \
    psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "$1" 2>/dev/null || true
}
MIGRATIONS_ON_DISK="$(find "${REPO_DIR}/server/drizzle" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
MIGRATIONS_APPLIED="$(db_value 'select count(*) from drizzle.__drizzle_migrations')"
if [[ "${MIGRATIONS_APPLIED}" == "${MIGRATIONS_ON_DISK}" ]]; then
  pass "all ${MIGRATIONS_ON_DISK} migrations applied"
else
  fail "migrations applied: '${MIGRATIONS_APPLIED}', in the checkout: ${MIGRATIONS_ON_DISK}"
fi
if [[ "$(db_value 'select count(*) from content_versions where publication_id is null')" == "0" ]]; then
  pass "every published version belongs to a publication"
else
  fail "published versions without a publication (migration 0003 not applied?)"
fi
# The content v2 backfill runs at API boot, after the migrations.
if [[ "$(db_value "select count(*) from content_documents where section in ('imprint', 'privacy')")" == "4" ]]; then
  pass "legal pages exist in both languages (content v2 backfill ran)"
else
  fail "legal pages missing from content_documents — check the api log for the content v2 backfill"
fi
LIVE_VERSION="$(db_value "select max(schema_version) from content_publications p join content_versions v on v.publication_id = p.id join content_pointers c on c.version_id = v.id")"
echo "  info  live content is schema v${LIVE_VERSION:-?} (v1 until the first publish after deploying v2; served upcast either way)"

echo "== services =="
check "client responds" curl -fsSI "${CLIENT}"
check "api /health" curl -fsS "${API}/health"
check "pgadmin responds" curl -fsSI "http://127.0.0.1:${PGADMIN_HOST_PORT}"

echo "== content read path =="
check "api serves the v2 core (en)" bash -c "curl -fsS '${API}/v2/content/en' | grep -q '\"version\":2'"
check "api serves the v2 core (de)" bash -c "curl -fsS '${API}/v2/content/de' | grep -q '\"version\":2'"
check "api serves a doc (the German imprint)" \
  bash -c "curl -fsS '${API}/v2/content/de/legal/imprint' | grep -q '\"kind\":\"legal\"'"
check "api still serves v1 for clients built before v2" \
  bash -c "curl -fsS '${API}/v1/content/en' | grep -q '\"version\":1'"
check "api rejects an unknown locale" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/v2/content/fr')\" = 400 ]"

# The one that matters: SSR must render what the database holds. If it does
# not, either prerendering came back or the BFF cannot reach the API.
HEADLINE="$(curl -fsS "${API}/v2/content/en" | sed -n 's/.*"heroHeadline":"\([^"]*\)".*/\1/p')"
if [[ -n "${HEADLINE}" ]] && curl -fsS "${CLIENT}/en" | grep -qF "${HEADLINE}"; then
  pass "SSR renders the published hero headline"
else
  fail "SSR renders the published hero headline (got '${HEADLINE}')"
fi

check "BFF is serving live content, not the bundled fallback" \
  bash -c "! curl -fsSI '${CLIENT}/api/v2/content/en' | grep -qi 'x-content-source: fallback'"
check "BFF serves docs (the German imprint)" \
  bash -c "curl -fsS '${CLIENT}/api/v2/content/de/legal/imprint' | grep -q '\"kind\":\"legal\"'"
check "legal pages render from the CMS" \
  bash -c "curl -fsS '${CLIENT}/de/legal/privacy' | grep -q 'class=\"prose-body\"'"

check "prerendered index.html is absent (edits must not need a rebuild)" \
  bash -c "! docker compose --env-file '${ENV_FILE}' -f '${COMPOSE_FILE}' exec -T client test -f dist/analog/public/index.html"

echo "== locale routing =="
check "/ redirects a German browser to /de" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Accept-Language: de-DE,de;q=0.9' '${CLIENT}/')\" = '302 ${CLIENT}/de' ]"
check "/ honours an explicit language choice over the browser" \
  bash -c "curl -s -o /dev/null -w '%{redirect_url}' -H 'Accept-Language: de' -H 'Cookie: portfolio-lang=en' '${CLIENT}/' | grep -q '/en\$'"
check "/de renders German (lang=\"de\")" bash -c "curl -fsS '${CLIENT}/de' | grep -q '<html lang=\"de\"'"
check "/de lists every language alternate" \
  bash -c "curl -fsS '${CLIENT}/de' | grep -q 'hreflang=\"x-default\"'"
check "an unknown language answers 404" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/fr')\" = 404 ]"
check "an unknown page answers 404" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/en/does-not-exist')\" = 404 ]"
check "legal pages are served" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/de/legal/privacy')\" = 200 ]"
check "the writing index is served" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/en/writing')\" = 200 ]"
check "an unknown case study answers 404" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/en/work/does-not-exist')\" = 404 ]"
check "an unknown post answers 404" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${CLIENT}/en/writing/does-not-exist')\" = 404 ]"

# /en/resume.pdf: 404 until a CV is set in the admin, then a redirect to the
# file, which the API names <Name>-CV-en.pdf.
RESUME="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${CLIENT}/en/resume.pdf")"
case "${RESUME}" in
  "404 "*) echo "  info  no English CV set yet (/en/resume.pdf answers 404)" ;;
  "302 ${CLIENT}/media/"*.pdf)
    # From the api: the SSR container itself does not serve /media (Caddy routes it).
    if curl -fsSI "${API}${RESUME#"302 ${CLIENT}"}" | tr -d '\r' | grep -qi '^content-disposition:.*-CV-en\.pdf'; then
      pass "/en/resume.pdf redirects to the CV, saved as <Name>-CV-en.pdf"
    else
      fail "/en/resume.pdf redirects, but the file is not named <Name>-CV-en.pdf (api not updated?)"
    fi
    ;;
  *) fail "/en/resume.pdf should redirect to /media/….pdf or answer 404 (got '${RESUME}')" ;;
esac

echo "== content security policy =="
# The SSR container sends the policy (CSP_MODE: enforce or report-only) with a
# nonce that must be new per request and match the inline scripts it renders.
# Reads headers on stdin; prints the policy's nonce.
nonce_of_headers() {
  tr -d '\r' | sed -n "s/^content-security-policy[a-z-]*:.*'nonce-\([^']*\)'.*/\1/Ip" | head -n1
}
# The nonce in /en's header must also be on the inline event-dispatch script.
contract_script_has_nonce() {
  local headers body nonce
  headers="$(mktemp)"
  body="$(curl -fsS -D "${headers}" "${CLIENT}/en")" || { rm -f "${headers}"; return 1; }
  nonce="$(nonce_of_headers <"${headers}")"
  rm -f "${headers}"
  [[ -n "${nonce}" ]] \
    && grep -o '<script[^>]*id="ng-event-dispatch-contract"[^>]*>' <<<"${body}" | grep -qF "nonce=\"${nonce}\""
}
NONCE_A="$(curl -fsSI "${CLIENT}/en" | nonce_of_headers || true)"
NONCE_B="$(curl -fsSI "${CLIENT}/en" | nonce_of_headers || true)"
if [[ -n "${NONCE_A}" && "${NONCE_A}" != "${NONCE_B}" ]]; then
  pass "pages carry a CSP with a fresh nonce per request"
else
  fail "pages carry a CSP with a fresh nonce per request (got '${NONCE_A}', '${NONCE_B}') — CSP_MODE=off?"
fi
check "the inline event-replay script carries the request's nonce" contract_script_has_nonce
CSP_HEADER="$(curl -fsSI "${CLIENT}/en" | tr -d '\r' | grep -io '^content-security-policy[a-z-]*' | head -n1 || true)"
echo "  info  served as: ${CSP_HEADER:-none} (CSP_MODE=enforce in .env once report-only stays quiet)"

echo "== crawler surface =="
check "robots.txt disallows /admin" bash -c "curl -fsS '${CLIENT}/robots.txt' | grep -q 'Disallow: /admin'"
check "robots.txt disallows /api/" bash -c "curl -fsS '${CLIENT}/robots.txt' | grep -q 'Disallow: /api/'"
check "sitemap.xml lists both languages with alternates" \
  bash -c "curl -fsS '${CLIENT}/sitemap.xml' | grep -q 'hreflang=\"de\"'"
check "each language has an RSS feed" \
  bash -c "curl -fsS '${CLIENT}/en/rss.xml' | grep -q '<rss version=\"2.0\"' && curl -fsS '${CLIENT}/de/rss.xml' | grep -q '<language>de</language>'"

echo "== auth boundary =="
check "admin is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/status')\" = 401 ]"
check "publish refuses a foreign Origin" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' '${API}/admin/publish')\" = 403 ]"
check "publications are locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/publications')\" = 401 ]"
check "contact inbox is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/messages')\" = 401 ]"

echo "== media =="
check "media route rejects traversal" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' --path-as-is '${API}/media/../../etc/passwd')\" = 404 ]"
MEDIA_OWNER="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api stat -c '%U' /data/media 2>/dev/null || true)"
if [[ "${MEDIA_OWNER}" == "node" ]]; then
  pass "media volume is owned by node (uploads will not EACCES)"
else
  fail "media volume owner is '${MEDIA_OWNER}', expected 'node' — see DEPLOYMENT.md, Media ownership"
fi
# sharp is a native module: the Alpine (musl) build must load, or every image
# upload fails with a 500 while everything else looks healthy.
check "sharp loads in the api container (image processing works)" \
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api \
  node -e "import('sharp').then((m) => process.exit(m.default.versions.vips ? 0 : 1), () => process.exit(1))"

echo "== edge (Caddy) =="
SITE="https://${CLIENT_PUBLIC_DOMAIN:-alirezarastineh.me}"
# The API's JSON 404 (not the site's HTML one) proves /media/* reaches the API.
check "site domain proxies /media/* to the api" \
  bash -c "curl -s '${SITE}/media/00000000-0000-4000-8000-000000000000.png' | grep -q '\"error\":\"not_found\"'"
check "internal _invalidate route is closed at the edge" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST '${SITE}/api/v1/content/_invalidate')\" = 404 ]"
# A second policy added by Caddy (the old report-only line) would apply on top
# of the container's, without its nonce.
check "the edge passes exactly one CSP through (none added by Caddy)" \
  bash -c "[ \"\$(curl -fsSI '${SITE}/en' | grep -ci '^content-security-policy')\" = 1 ]"

echo
if [[ "${FAILURES}" -gt 0 ]]; then
  echo "Verification FAILED: ${FAILURES} check(s)."
  exit 1
fi
echo "Verification successful."
