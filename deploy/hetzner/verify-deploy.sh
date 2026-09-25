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
if [[ "$(db_value "select is_nullable from information_schema.columns where table_name = 'content_versions' and column_name = 'publication_id'")" == "NO" ]]; then
  pass "every published version belongs to a publication (NOT NULL)"
else
  fail "content_versions.publication_id is still nullable (migration 0009 not applied?)"
fi
if [[ "$(db_value "select count(*) from information_schema.columns where table_name = 'projects' and column_name in ('image_id', 'image_path')")" == "0" ]]; then
  pass "the v1 project image columns are gone"
else
  fail "projects still has image_id/image_path (migration 0009 not applied?)"
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
check "api no longer serves the v1 contract" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/v1/content/en')\" = 404 ]"
check "api rejects an unknown locale" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/v2/content/fr')\" = 400 ]"

# The one that matters: SSR must render what the database holds. If it does
# not, either prerendering came back or the BFF cannot reach the API.
HEADLINE="$(curl -fsS "${API}/v2/content/en" | sed -n 's/.*"heroHeadline":"\([^"]*\)".*/\1/p')"
# The page is read whole first: piped into `grep -q`, which stops at the first
# match, curl fails writing the rest of a page larger than the pipe buffer
# (curl: (23)), and under pipefail a found headline would count as missing.
HOME_EN="$(curl -fsS "${CLIENT}/en" || true)"
if [[ -n "${HEADLINE}" ]] && grep -qF "${HEADLINE}" <<<"${HOME_EN}"; then
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
# The nonce in /en's header must also be on an inline script the page names by
# id: Analog's event-dispatch contract, or index.html's theme script.
script_has_nonce() {
  local id="$1" headers body nonce
  headers="$(mktemp)"
  body="$(curl -fsS -D "${headers}" "${CLIENT}/en")" || { rm -f "${headers}"; return 1; }
  nonce="$(nonce_of_headers <"${headers}")"
  rm -f "${headers}"
  [[ -n "${nonce}" ]] \
    && grep -o "<script[^>]*id=\"${id}\"[^>]*>" <<<"${body}" | grep -qF "nonce=\"${nonce}\""
}
NONCE_A="$(curl -fsSI "${CLIENT}/en" | nonce_of_headers || true)"
NONCE_B="$(curl -fsSI "${CLIENT}/en" | nonce_of_headers || true)"
if [[ -n "${NONCE_A}" && "${NONCE_A}" != "${NONCE_B}" ]]; then
  pass "pages carry a CSP with a fresh nonce per request"
else
  fail "pages carry a CSP with a fresh nonce per request (got '${NONCE_A}', '${NONCE_B}') — CSP_MODE=off?"
fi
check "the inline event-replay script carries the request's nonce" script_has_nonce ng-event-dispatch-contract
check "the inline theme script carries the request's nonce" script_has_nonce theme-init
check "the inline app loader carries the request's nonce" script_has_nonce app-boot
CSP_HEADER="$(curl -fsSI "${CLIENT}/en" | tr -d '\r' | grep -io '^content-security-policy[a-z-]*' | head -n1 || true)"
echo "  info  served as: ${CSP_HEADER:-none} (CSP_MODE=enforce in .env once report-only stays quiet)"

echo "== crawler surface =="
check "robots.txt disallows /admin" bash -c "curl -fsS '${CLIENT}/robots.txt' | grep -q 'Disallow: /admin'"
check "robots.txt disallows /api/" bash -c "curl -fsS '${CLIENT}/robots.txt' | grep -q 'Disallow: /api/'"
check "sitemap.xml lists both languages with alternates" \
  bash -c "curl -fsS '${CLIENT}/sitemap.xml' | grep -q 'hreflang=\"de\"'"
check "each language has an RSS feed" \
  bash -c "curl -fsS '${CLIENT}/en/rss.xml' | grep -q '<rss version=\"2.0\"' && curl -fsS '${CLIENT}/de/rss.xml' | grep -q '<language>de</language>'"

echo "== assets =="
# Nitro serves the build's scripts and styles pre-compressed (compressPublicAssets).
STYLESHEET="$(grep -o 'href="/assets/[^"]*\.css"' <<<"${HOME_EN}" | head -n1 | cut -d'"' -f2 || true)"
check "the stylesheet is served pre-compressed (brotli)" \
  bash -c "curl -fsSI -H 'Accept-Encoding: br' '${CLIENT}${STYLESHEET}' | tr -d '\r' | grep -qi '^content-encoding: br'"
check "the web manifest and icons are served" \
  bash -c "curl -fsS '${CLIENT}/site.webmanifest' | grep -q '\"icons\"' && curl -fsSI '${CLIENT}/favicon.svg' >/dev/null && curl -fsSI '${CLIENT}/apple-touch-icon.png' >/dev/null"
# resvg is a native module, like sharp: the Alpine (musl) build must load, or
# every social card falls back to the default image.
check "resvg loads in the client container (social cards render)" \
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T client \
  node -e "import('@resvg/resvg-js').then((m) => { new m.Resvg('<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2\" height=\"2\"></svg>').render().asPng(); process.exit(0); }, () => process.exit(1))"
# The first published case study, read with the api container's node (the host
# may have no JSON tool).
CASE_STUDY="$(curl -fsS "${API}/v2/content/en" | docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api \
  node -e "let s='';process.stdin.on('data',(d)=>(s+=d)).on('end',()=>{const p=JSON.parse(s).projects.find((x)=>x.hasCaseStudy);process.stdout.write(p?p.slug:'')})" || true)"
if [[ -n "${CASE_STUDY}" ]]; then
  # A GET without following redirects: a failed render redirects to /og.png,
  # which is a PNG too.
  check "a case study's social card renders (/en/og/work/${CASE_STUDY}.png)" \
    bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code} %{content_type}' '${CLIENT}/en/og/work/${CASE_STUDY}.png')\" = '200 image/png' ]"
else
  echo "  info  no case study published yet; the social-card route is checked once there is one"
fi

echo "== auth boundary =="
check "admin is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/status')\" = 401 ]"
check "publish refuses a foreign Origin" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' '${API}/admin/publish')\" = 403 ]"
check "publications are locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/publications')\" = 401 ]"
check "contact inbox is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/messages')\" = 401 ]"
# Admin tools (Phase 8): the publish review, the translation report and the
# draft preview show unpublished content, so none may answer without a session.
check "the publish review is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/publish/review')\" = 401 ]"
check "the translation report is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/i18n')\" = 401 ]"
check "the draft preview's content is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/content/preview/en/legal/imprint')\" = 401 ]"
# The page itself renders only the admin skeleton on the server; the draft
# loads in the browser, with the session.
check "the draft preview page renders (skeleton, noindex)" \
  bash -c "curl -fsS '${CLIENT}/admin/preview/en' | grep -q 'noindex, nofollow'"

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
# With the site's own Origin, so the refusal comes from the session check.
check "media cleanup is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://${CLIENT_PUBLIC_DOMAIN:-alirezarastineh.me}' -H 'Content-Type: application/json' -d '{\"ids\":[]}' '${API}/admin/media/cleanup')\" = 401 ]"
check "sharp loads in the api container (image processing works)" \
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api \
  node -e "import('sharp').then((m) => process.exit(m.default.versions.vips ? 0 : 1), () => process.exit(1))"

echo "== assistant =="
# None of these calls a model: nothing here costs money.
ASK_CONFIG="$(curl -fsS "${API}/v1/ask/config" 2>/dev/null || true)"
if [[ "${ASK_CONFIG}" == *'"state"'* ]]; then
  ASK_STATE="$(sed -n 's/.*"state":"\([a-z]*\)".*/\1/p' <<<"${ASK_CONFIG}")"
  pass "assistant config is served (state: ${ASK_STATE:-?})"
  if [[ "${ASK_STATE}" != "ok" ]]; then
    echo "  info  the assistant is ${ASK_STATE}: SERVER_AI_ENABLED, a model key, the admin switch, or today's budget"
  fi
else
  fail "assistant config is not served (${API}/v1/ask/config)"
fi
check "assistant rejects a malformed question without calling a model" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' '${API}/v1/ask')\" = 400 ]"
check "assistant admin is locked without a session" \
  bash -c "[ \"\$(curl -s -o /dev/null -w '%{http_code}' '${API}/admin/assistant/settings')\" = 401 ]"
if [[ "$(db_value "select count(*) from information_schema.tables where table_name in ('ai_settings', 'ai_faq', 'ai_usage', 'ai_messages', 'ai_feedback', 'ai_rate_events')")" == "6" ]]; then
  pass "assistant tables exist (migration 0008)"
else
  fail "assistant tables missing — migration 0008_ask_assistant not applied?"
fi
check "the assistant's search and tokenizer load in the api container" \
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T api \
  node -e "Promise.all([import('minisearch'), import('js-tiktoken/lite'), import('js-tiktoken/ranks/o200k_base')]).then(() => process.exit(0), () => process.exit(1))"
# Three ticks 400 ms apart: streamed, the first arrives long before the last.
STREAM_TIMES="$(curl -s -o /dev/null -w '%{time_starttransfer} %{time_total}' "${API}/v1/ask/stream-check" || true)"
if awk -v t="${STREAM_TIMES}" 'BEGIN { split(t, a, " "); exit !(a[2] - a[1] > 0.5) }'; then
  pass "the api streams (first byte ${STREAM_TIMES%% *}s, end ${STREAM_TIMES##* }s)"
else
  fail "the api buffers its stream (first byte / end: ${STREAM_TIMES})"
fi

echo "== edge (Caddy) =="
SITE="https://${CLIENT_PUBLIC_DOMAIN:-alirezarastineh.me}"
API_SITE="https://${SERVER_PUBLIC_DOMAIN:-api.alirezarastineh.me}"
# Compression or proxy buffering would deliver an answer in one lump at the end.
EDGE_STREAM_TIMES="$(curl -s -o /dev/null -H 'Accept-Encoding: gzip, zstd' -w '%{time_starttransfer} %{time_total}' "${API_SITE}/v1/ask/stream-check" || true)"
if awk -v t="${EDGE_STREAM_TIMES}" 'BEGIN { split(t, a, " "); exit !(a[2] - a[1] > 0.5) }'; then
  pass "Caddy passes the assistant's stream through as it happens"
else
  fail "Caddy buffers the assistant's stream (first byte / end: ${EDGE_STREAM_TIMES}) — see the @stream block in the Caddyfile"
fi
STREAM_HEADERS="$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip, zstd' "${API_SITE}/v1/ask/stream-check" || true)"
if ! grep -qi '^content-encoding' <<<"${STREAM_HEADERS}"; then
  pass "the assistant's stream is not compressed at the edge"
else
  fail "the assistant's stream is compressed at the edge (it would be buffered)"
fi
CONTENT_HEADERS="$(curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "${API_SITE}/v2/content/en" || true)"
if grep -qi '^content-encoding' <<<"${CONTENT_HEADERS}"; then
  pass "the content JSON is still compressed at the edge"
else
  fail "the content JSON is no longer compressed at the edge"
fi
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
