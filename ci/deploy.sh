#!/bin/sh
# The deploy's steps after its guard (Woodpecker plan, Phase 12; the GitHub
# Actions plan, Part E): what both CIs' deploy workflows run, from the repo
# root, on the CI's Docker. GHCR_TOKEN may push to GHCR (Woodpecker: a classic
# token with write:packages; GitHub: the workflow's own token), and the
# DEPLOY_* values reach production's forced command.
#   sh ci/deploy.sh <images|rollout|latest>
set -eu
cd "$(dirname "$0")/.."
sha=${CI_COMMIT_SHA:?}
registry=ghcr.io/alirezarastineh/portfolio-2026

# The token's check comes first: inside the pipe it would stop only the pipe's
# own side, and docker login would run anyway.
login() {
  : "${GHCR_TOKEN:?}"
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username alirezarastineh --password-stdin
}

case "${1:-}" in
  # Both images, pushed under the commit's tag. The client gets production's
  # public values (deploy/hetzner/client-public.env); the API reads its secrets
  # at run time, so neither image holds one. The source label links each
  # package to the repository on GitHub.
  images)
    login
    docker buildx build --push --tag "$registry/api:$sha" \
      --label "org.opencontainers.image.source=https://github.com/alirezarastineh/Portfolio-2026" server
    set -a && . deploy/hetzner/client-public.env && set +a
    docker buildx build --push --tag "$registry/client:$sha" \
      --label "org.opencontainers.image.source=https://github.com/alirezarastineh/Portfolio-2026" \
      --build-arg VITE_API_BASE_URL --build-arg VITE_SENTRY_DSN \
      --build-arg VITE_UMAMI_SRC --build-arg VITE_UMAMI_WEBSITE_ID \
      --build-arg VITE_TURNSTILE_SITE_KEY --build-arg API_INTERNAL_BASE_URL=http://api:3000 \
      client
    docker logout ghcr.io
    # Production pulls without logging in, so both packages must be public.
    # The first push creates them private: make them public then
    # (deploy/woodpecker/README.md, "Deploys"), and deploy again.
    for image in api client; do
      DOCKER_CONFIG=$(mktemp -d) docker buildx imagetools inspect "$registry/$image:$sha" > /dev/null ||
        { echo "$image is private, and production can't pull it: make the package public, then deploy again"; exit 1; }
    done
    ;;
  # The key can run one command on production, ci-deploy.sh, which reads the
  # commit from `deploy <sha>`. The rollout runs there as a systemd unit, so a
  # connection that drops here never cuts it off halfway; this step follows its
  # log and ends with its exit status.
  rollout)
    umask 077 && mkdir -p /tmp/ssh
    printf '%s\n' "${DEPLOY_SSH_KEY:?}" > /tmp/ssh/key
    printf '%s\n' "${DEPLOY_KNOWN_HOSTS:?}" > /tmp/ssh/known_hosts
    ssh -i /tmp/ssh/key -o IdentitiesOnly=yes -o BatchMode=yes \
      -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tmp/ssh/known_hosts \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
      "${DEPLOY_USER:?}@${DEPLOY_HOST:?}" deploy "$sha"
    ;;
  # In the registry alone, nothing downloaded: `:latest` follows production,
  # never a build that failed to roll out. Nothing pulls it.
  latest)
    login
    for image in api client; do
      docker buildx imagetools create --tag "$registry/$image:latest" "$registry/$image:$sha"
    done
    docker logout ghcr.io
    ;;
  *)
    echo "usage: sh ci/deploy.sh <images|rollout|latest>" >&2
    exit 2
    ;;
esac
