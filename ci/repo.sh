#!/bin/sh
# Infrastructure lint (Woodpecker plan, Phases 6 and 8; GitHub Actions plan,
# Phase 2): what both CIs' repo workflows run, from the repo root, each step
# inside its tool's image. The workflows pin the images.
#   sh ci/repo.sh <workflows|shellcheck|hadolint|compose|caddy|trivy|gitleaks>
#   sh ci/repo.sh <actionlint|zizmor|parity>
set -eu
cd "$(dirname "$0")/.."

case "${1:-}" in
  # Every Woodpecker workflow, against the schema of the server's version.
  workflows)
    woodpecker-cli lint --strict .woodpecker
    ;;
  # -x with SCRIPTDIR: the deploy scripts source load-env.sh from their folder.
  shellcheck)
    shellcheck -x --source-path=SCRIPTDIR deploy/hetzner/*.sh deploy/woodpecker/*.sh ci/*.sh
    ;;
  # Waivers, each with its reason, in .hadolint.yaml.
  hadolint)
    hadolint server/Dockerfile client/Dockerfile ci/Dockerfile ci/smoke.Dockerfile
    ;;
  # `config -q` resolves each stack as compose would start it: its files, its
  # overlay, every profile. The values below only fill the variables the files
  # require (`:?`); nothing starts.
  compose)
    export CONTENT_INVALIDATE_TOKEN=ci IMAGE_TAG=ci PGADMIN_DEFAULT_EMAIL=ci@example.com \
      PGADMIN_DEFAULT_PASSWORD=ci POSTGRES_PASSWORD=ci RESEND_API_KEY=ci \
      WOODPECKER_AGENT_SECRET=ci WOODPECKER_GITHUB_CLIENT=ci WOODPECKER_GITHUB_SECRET=ci \
      WOODPECKER_GRPC_SECRET=ci WOODPECKER_TUNNEL_HOST=ci.example.com WOODPECKER_TUNNEL_KEYS=/keys
    docker compose -f compose.yaml config -q
    docker compose -f deploy/hetzner/docker-compose.yml -f deploy/hetzner/docker-compose.images.yml --profile "*" config -q
    # The stack smoke test's overlay (Woodpecker plan, Phase 11, ci/stack-smoke.sh).
    docker compose -f deploy/hetzner/docker-compose.yml -f ci/compose.ci.yml config -q
    docker compose -f deploy/woodpecker/docker-compose.server.yml config -q
    docker compose -f deploy/woodpecker/docker-compose.agent.yml config -q
    ;;
  # Production's Caddy is 2.11.4 (`caddy version`, 2026-10-15).
  caddy)
    caddy adapt --config deploy/hetzner/Caddyfile > /dev/null
    caddy adapt --config deploy/woodpecker/Caddyfile > /dev/null
    ;;
  # The Dockerfiles' misconfigurations: Trivy has no checks for compose files,
  # which `compose` covers. Waivers, each with its reason, in .trivyignore.
  trivy)
    trivy config --skip-version-check --exit-code 1 .
    ;;
  # Secrets in the working tree (Woodpecker plan, Phase 8). The repo is public;
  # .env*, DEPLOYMENT.md and .claude/ are git-ignored, so this catches
  # accidents. Waivers, each with its reason, in .gitleaks.toml. --redact keeps
  # a found secret out of the log.
  gitleaks)
    gitleaks dir --config .gitleaks.toml --redact --no-banner --verbose .
    ;;
  # The GitHub workflows' syntax, expressions and types; its image's shellcheck
  # reads their `run:` scripts. Named files: without them actionlint looks for a
  # .git directory, which a dry run's copy lacks.
  actionlint)
    actionlint -color .github/workflows/*.yml
    ;;
  # The GitHub workflows' security: unpinned actions (.github/zizmor.yml wants a
  # commit SHA for every one), template injection, excessive permissions, a
  # checkout that keeps its token. Offline, so both CIs get the same findings.
  zizmor)
    zizmor --offline --no-progress --config .github/zizmor.yml .github/workflows
    ;;
  # The two CI definitions in step: the same steps, image pins and pull request
  # filters (ci/ci-parity.mjs).
  parity)
    node ci/ci-parity.mjs
    ;;
  *)
    echo "usage: sh ci/repo.sh <workflows|shellcheck|hadolint|compose|caddy|trivy|gitleaks|actionlint|zizmor|parity>" >&2
    exit 2
    ;;
esac
