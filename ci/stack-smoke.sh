#!/usr/bin/env bash
# The production-like stack smoke test (plan Phase 11), run by the helper that
# images.yaml starts on the host's network (ci/smoke.Dockerfile):
# - the API and client images this pipeline built, booted with Postgres as
#   production runs them (deploy/hetzner/docker-compose.yml, ci/compose.ci.yml);
# - the real migrations, applied at the API's boot;
# - the seed's content, published through the API image's own seed;
# - then verify-deploy.sh with VERIFY_CI=1, which skips only what production
#   alone has.
# The stack is its own compose project, ci-<pipeline>, on loopback ports taken
# from the pipeline number, so two runs never meet. It is removed on exit, pass
# or fail; agent-cleanup.sh sweeps what a canceled run leaves behind.
set -euo pipefail
cd "$(dirname "$0")/.."

pipeline=${CI_PIPELINE_NUMBER:?}
tag=${CI_COMMIT_SHA:?}
project=ci-$pipeline
# 20000-29999, ten ports a pipeline: a dry run (pipeline 0) gets 20000.
port=$((20000 + pipeline % 1000 * 10))
secret() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
password=$(secret)
token=$(secret)

# A throwaway .env, which compose and verify-deploy.sh read as production's.
cat > .env << EOF
COMPOSE_PROJECT_NAME=$project
IMAGE_TAG=$tag
POSTGRES_USER=portfolio
POSTGRES_DB=portfolio
POSTGRES_PASSWORD=$password
POSTGRES_HOST_PORT=$port
API_HOST_PORT=$((port + 1))
CLIENT_HOST_PORT=$((port + 2))
PGADMIN_HOST_PORT=$((port + 3))
PGADMIN_DEFAULT_EMAIL=ci@example.com
PGADMIN_DEFAULT_PASSWORD=$(secret)
RESEND_API_KEY=ci-not-a-key
CONTENT_INVALIDATE_TOKEN=$token
CSP_MODE=enforce
SERVER_AI_ENABLED=false
EOF

compose() { docker compose --env-file .env -f deploy/hetzner/docker-compose.yml -f ci/compose.ci.yml "$@"; }
finish() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "== the stack's last log lines"
    compose logs --no-color --tail 60 db api client || true
  fi
  compose down --volumes --remove-orphans --timeout 5 > /dev/null 2>&1 || true
  exit "$status"
}
trap finish EXIT
# What a run of the same number left behind when it was cut off (every dry run is 0).
compose down --volumes --remove-orphans --timeout 5 > /dev/null 2>&1 || true

echo "== up: $project on 127.0.0.1:$port-$((port + 2))"
start=$SECONDS
compose up --detach --no-build --wait --wait-timeout 180 db api client
echo "healthy after $((SECONDS - start)) s"

echo "== seed"
# The API image's own seed, on the stack's network: its dist holds the code,
# and seed.json, which tsc does not emit, is copied in. The label lets
# `down --remove-orphans` and agent-cleanup.sh find it if a run is cut off.
start=$SECONDS
seeder=$(docker create --rm --label "com.docker.compose.project=$project" \
  --network "${project}_internal" \
  --env NODE_ENV=production \
  --env DATABASE_URL="postgresql://portfolio:$password@db:5432/portfolio" \
  --env CONTENT_INVALIDATE_URL=http://client:3000/api/v1/content/_invalidate \
  --env CONTENT_INVALIDATE_TOKEN="$token" \
  "portfolio/api:$tag" node dist/src/db/seed-cli.js)
docker cp server/src/db/seed "$seeder:/usr/src/app/dist/src/db/"
docker start --attach "$seeder"
echo "seeded in $((SECONDS - start)) s"

echo "== verify-deploy.sh"
start=$SECONDS
VERIFY_CI=1 bash deploy/hetzner/verify-deploy.sh
echo "verified in $((SECONDS - start)) s"
