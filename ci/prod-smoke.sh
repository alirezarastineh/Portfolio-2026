#!/usr/bin/env bash
# The daily smoke test of the live site (plan Phase 13, .woodpecker/prod-smoke.yaml):
# what a visitor or a crawler gets from outside, through Caddy. Read-only: no
# session, no model call, nothing written but the rate limits' own events (the
# API prunes them within a day). Like verify-deploy.sh, it reports
# every failure in one run. GitHub's prod-smoke.yml runs it too (the GitHub
# Actions plan, Phase 8): there each failed check and the result also go on the
# run's page, which reads without a login, and in the job's summary.
#   bash ci/prod-smoke.sh [site] [api]
set -uo pipefail

SITE="${1:-https://alirezarastineh.me}"
API="${2:-https://api.alirezarastineh.me}"
FAILURES=0
CHECKS=0

on_github() { [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; }
pass() { echo "  ok    $1"; CHECKS=$((CHECKS + 1)); }
fail() {
  echo "  FAIL  $1"
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  # Workflow commands escape % in their message.
  if on_github; then echo "::error title=live::${1//\%/%25}"; fi
}
# The body, the headers or the status of a request; empty or 000 when it fails.
# Each waits 20 s at most, so a hung site fails the check instead of the step.
body() { curl -fsS --max-time 20 "$@" 2>/dev/null || true; }
headers() { curl -fsSI --max-time 20 "$@" 2>/dev/null | tr -d '\r' || true; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" 2>/dev/null || true; }
# expect <label> <command…>: passes when the command succeeds.
expect() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then pass "${label}"; else fail "${label}"; fi
}

echo "== ${SITE}"
REDIRECT="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 20 "${SITE}/" || true)"
expect "/ redirects to a language (${REDIRECT})" grep -qE "^302 ${SITE}/(en|de)$" <<< "${REDIRECT}"
HOME_EN="$(body "${SITE}/en")"
expect "/en renders English" grep -qF '<html lang="en"' <<< "${HOME_EN}"
expect "/de renders German" grep -qF '<html lang="de"' <<< "$(body "${SITE}/de")"
expect "an unknown page answers 404" test "$(code "${SITE}/en/does-not-exist")" = 404
# A second policy (from Caddy, say) would apply on top of the page's, without
# its nonce.
HEADERS_EN="$(headers "${SITE}/en")"
CSP="$(grep -ci '^content-security-policy' <<< "${HEADERS_EN}")"
expect "exactly one CSP header (${CSP})" test "${CSP}" = 1
expect "the CSP carries a nonce" grep -qi "^content-security-policy.*'nonce-" <<< "${HEADERS_EN}"
# A GET: the route answers HEAD with the 404 page. `stale` means the client
# can't reach the API; `fallback` is the bundled copy.
BFF="$(curl -fsS -D - -o /dev/null --max-time 20 "${SITE}/api/v2/content/en" 2> /dev/null | tr -d '\r' || true)"
SOURCE="$(grep -i '^x-content-source:' <<< "${BFF}" | cut -d' ' -f2)"
expect "the BFF serves live content (${SOURCE:-no source})" grep -qiE '^x-content-source: (api|cache)$' <<< "${BFF}"

echo "== crawlers and agents"
expect "robots.txt disallows /admin" grep -q 'Disallow: /admin' <<< "$(body "${SITE}/robots.txt")"
expect "sitemap.xml lists both languages" grep -qF 'hreflang="de"' <<< "$(body "${SITE}/sitemap.xml")"
expect "llms.txt is served (en)" grep -q '^# ' <<< "$(body "${SITE}/en/llms.txt")"
expect "the agent card is served" grep -qF '"skills"' <<< "$(body "${SITE}/.well-known/agent-card.json")"

echo "== ${API}"
expect "/health is ok" grep -qF '"status":"ok"' <<< "$(body "${API}/health")"
expect "the v2 content is served (en)" grep -qF '"version":2' <<< "$(body "${API}/v2/content/en")"
# A discovery, as verify-deploy.sh sends it: no model answers it.
MCP_DISCOVER='{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
expect "the MCP endpoint answers a discovery" grep -qF '"supportedVersions"' <<< "$(body -X POST "${API}/v1/mcp" \
  -H 'content-type: application/json' -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: server/discover' -d "${MCP_DISCOVER}")"

echo "== the visitors' assistant (visitor plan V22; no model answers any of these)"
CONFIG="$(body "${API}/v1/ask/config")"
STATE="$(sed -n 's/.*"state":"\([a-z]*\)".*/\1/p' <<< "${CONFIG}")"
expect "the assistant's config says its state (${STATE:-none})" grep -qE '^(ok|off|resting)$' <<< "${STATE}"
expect "the config gives a question's limits" \
  grep -qE '"limits":\{"maxChars":[0-9]+,"historyTurns":[0-9]+\}' <<< "${CONFIG}"
expect "the config says whether match is offered" grep -qE '"match":(true|false)' <<< "${CONFIG}"
# The match page answers either way; llms.txt lists it only while match is on (plan 3 W3). The
# client's server holds the config 5 minutes, so a run just after the switch can fail once.
expect "the match page is served" test "$(code "${SITE}/en/match")" = 200
if grep -qF '"match":true' <<< "${CONFIG}"; then
  expect "llms.txt lists the match page" grep -qF '/en/match)' <<< "$(body "${SITE}/en/llms.txt")"
fi
expect "the portfolio map lists pages (en)" grep -qF '"pages":[{' <<< "$(body "${API}/v1/ask/map?locale=en")"
# Three ticks 400 ms apart: streamed through Caddy, the first arrives well before the last.
STREAM="$(curl -s -N --max-time 20 -w '\n%{time_starttransfer} %{time_total}' \
  "${API}/v1/ask/stream-check" 2> /dev/null || true)"
TICKS="$(grep -c '^data: tick' <<< "${STREAM}")"
TIMES="$(tail -n 1 <<< "${STREAM}")"
expect "the stream check's three ticks arrive unbuffered within 3 s (${TICKS}; first byte, end: ${TIMES})" \
  awk -v n="${TICKS}" -v t="${TIMES}" \
  'BEGIN { split(t, a, " "); exit !(n == 3 && a[2] - a[1] > 0.5 && a[2] < 3) }'
# The scorecard answers as the admin's switch says: published, or a 404 saying it is not.
SCORE="$(curl -s --max-time 20 -w ' %{http_code}' "${API}/v1/ask/scorecard" 2> /dev/null || true)"
if grep -qF '"scorecard":true' <<< "${CONFIG}"; then
  expect "the scorecard is published" grep -qE '"recorded".* 200$' <<< "${SCORE}"
else
  expect "the scorecard says it is not published" grep -qE 'not_published.* 404$' <<< "${SCORE}"
fi

echo
if [[ "${FAILURES}" -gt 0 ]]; then
  echo "Smoke test FAILED: ${FAILURES} of ${CHECKS} checks."
  if on_github; then echo "- **live**: ${FAILURES} of ${CHECKS} checks failed" >> "${GITHUB_STEP_SUMMARY}"; fi
  exit 1
fi
echo "Smoke test passed: ${CHECKS} checks."
if on_github; then
  echo "::notice title=live::${CHECKS} checks passed on ${SITE} and ${API}"
  echo "- **live**: ${CHECKS} checks passed on ${SITE} and ${API}" >> "${GITHUB_STEP_SUMMARY}"
fi
