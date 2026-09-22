# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
ARG PNPM_VERSION=11.0.0

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /usr/src/app
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm@${PNPM_VERSION}

# Production dependencies only; bind mounts keep the manifests out of the layer.
FROM base AS deps
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --prod --frozen-lockfile

# tsc needs the dev dependencies.
FROM deps AS build
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM base AS final
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Create the media root while still root. Docker seeds an empty named volume
# from the image's directory content and ownership on first mount, which is the
# only chance to get this right: the container runs as `node` with cap_drop: ALL
# and so cannot chown the mountpoint itself.
RUN mkdir -p /data/media/tmp && chown -R node:node /data/media

USER node

COPY package.json .
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
# Migrations are plain .sql, which tsc does not emit — copy them explicitly so
# the in-process boot migrator can find them.
COPY --from=build /usr/src/app/drizzle ./drizzle

EXPOSE 3000
CMD ["node", "dist/src/index.js"]
