# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 — base: node + corepack + pnpm
# ---------------------------------------------------------------------------
FROM node:25-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 2 — deps: install ALL workspace dependencies (frozen lockfile)
# Used only by the build and migrate stages which need devDependencies.
# ---------------------------------------------------------------------------
FROM base AS deps

# Copy workspace manifests and lockfile — only these layers need to rebuild
# when dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3 — prod-deps: install production-only dependencies for the runtime
# ---------------------------------------------------------------------------
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN pnpm install --prod --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 4 — build: compile contracts then api
# ---------------------------------------------------------------------------
FROM deps AS build

# Copy source for both packages
COPY packages/contracts/ ./packages/contracts/
COPY apps/api/ ./apps/api/
COPY tsconfig.base.json ./

RUN pnpm --filter @medbridge/contracts build && \
    pnpm --filter @medbridge/api build

# ---------------------------------------------------------------------------
# Stage 5 — migrate: one-shot drizzle-kit migrate + seed
# Needs devDependencies (drizzle-kit), so copies from deps (all deps).
# ---------------------------------------------------------------------------
FROM base AS migrate

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy node_modules (includes drizzle-kit as a devDependency)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy built dist (seed script lives at dist/seed/main.js)
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Copy drizzle config and migrations (drizzle-kit reads these at runtime)
COPY apps/api/drizzle.config.ts ./apps/api/drizzle.config.ts
COPY apps/api/src/db/migrations ./apps/api/src/db/migrations

# Copy package manifests so pnpm filter resolution works
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

WORKDIR /app/apps/api

USER app

CMD ["sh", "-c", "pnpm drizzle-kit migrate && node dist/seed/main.js"]

# ---------------------------------------------------------------------------
# Stage 6 — runtime: minimal api server (no devDependencies)
# ---------------------------------------------------------------------------
FROM base AS runtime

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Copy production-only node_modules from prod-deps stage
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules

# Copy built dist
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Copy package manifests for module resolution
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

WORKDIR /app/apps/api

USER app

EXPOSE 3000

CMD ["node", "dist/main.js"]
