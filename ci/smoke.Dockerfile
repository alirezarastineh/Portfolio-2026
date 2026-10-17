# syntax=docker/dockerfile:1
# The stack smoke test's helper (plan Phase 11, ci/stack-smoke.sh). images.yaml
# starts it through the agent's Docker on the host's network, so that it reaches
# the ports the stack publishes on loopback, as verify-deploy.sh does on
# production. Debian for the bash, curl and GNU tools that script uses there,
# and the docker CLI and compose from the image the other steps run.
FROM docker:29.9.0-cli AS docker

FROM node:22-bookworm
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
# What the test reads, by name (smoke.Dockerfile.dockerignore sends nothing
# else), root's and read-only to it: its script and compose overlay,
# production's compose file and checks, the migrations verify-deploy.sh
# counts, and the seed.
COPY ci/stack-smoke.sh ci/compose.ci.yml /repo/ci/
COPY deploy/hetzner/docker-compose.yml deploy/hetzner/verify-deploy.sh deploy/hetzner/load-env.sh /repo/deploy/hetzner/
COPY server/drizzle /repo/server/drizzle
COPY server/src/db/seed /repo/server/src/db/seed
# The one file the test writes: its throwaway .env, where verify-deploy.sh
# reads production's, at the checkout's root.
RUN install -o node -g node -m 600 /dev/null /repo/.env
WORKDIR /repo
USER node
