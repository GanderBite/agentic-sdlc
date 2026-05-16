# syntax=docker/dockerfile:1
# Multi-stage Dockerfile for @medbridge/api
# Stages: base → deps → build → migrate (one-shot) | runtime (long-lived)

# ---------------------------------------------------------------------------
# base — node runtime + corepack / pnpm
# ---------------------------------------------------------------------------
FROM node:25-alpine AS base
RUN corepack enable

# ---------------------------------------------------------------------------
# deps — install all workspace deps with a frozen lockfile.
# Context is the repo root so the full workspace is available.
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# Copy manifests + lockfile first to maximise layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — compile @medbridge/api TypeScript and copy migration SQL files.
# contracts is source-only (exports ./src/index.ts) so no build step there.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Copy all source (node_modules already present from the deps stage).
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY packages/contracts/src ./packages/contracts/src
COPY tsconfig.base.json ./

# Build the api package (tsc -b && cp -r src/db/migrations dist/db/migrations).
RUN pnpm --filter @medbridge/api build

# ---------------------------------------------------------------------------
# migrate — one-shot: run drizzle-kit migrate then node seed.
# Inherits the full build workspace so drizzle-kit (a devDep) is available.
# drizzle.config.ts uses relative paths so we cd into apps/api before running.
# ---------------------------------------------------------------------------
FROM build AS migrate
WORKDIR /app/apps/api

CMD ["sh", "-c", "pnpm drizzle-kit migrate && node dist/seed/main.js"]

# ---------------------------------------------------------------------------
# runtime — minimal production server image.
# ---------------------------------------------------------------------------
FROM base AS runtime
WORKDIR /app

# Workspace root manifests (required for pnpm workspace resolution at runtime).
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Package manifests.
COPY --from=deps /app/apps/api/package.json ./apps/api/package.json
COPY --from=deps /app/packages/contracts/package.json ./packages/contracts/package.json

# Installed node_modules (hoisted workspace root).
COPY --from=deps /app/node_modules ./node_modules

# contracts source (package exports ./src/index.ts — no compiled dist).
COPY --from=build /app/packages/contracts/src ./packages/contracts/src

# Compiled api output (includes dist/db/migrations copied by the build script).
COPY --from=build /app/apps/api/dist ./apps/api/dist

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
