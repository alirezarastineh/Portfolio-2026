# syntax=docker/dockerfile:1
# The CI image (plan Phase 4): every client and server step runs in it, so they
# share one glibc toolchain and its native binaries, and no step installs tools
# at run time. .woodpecker/ci-image.yaml builds it on the agent; its tag names
# what it holds, and all three workflows use that tag.
FROM node:22-bookworm

ARG PNPM_VERSION=11.0.0
ARG PW_VERSION=1.64.1

RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force

# Playwright's Chromium and the system libraries it needs. The client's
# pw-version step fails when the lockfile's @playwright/test moves away from it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PW_VERSION=${PW_VERSION}
RUN npx -y playwright@${PW_VERSION} install --with-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

# Steps run as the image's unprivileged user, install scripts and tests
# included. The workflows' `owner` step alone runs as root, to hand it the
# root-owned clone and pnpm store.
USER node
