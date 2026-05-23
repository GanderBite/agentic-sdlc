# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=25

# ---------- stage 1: deps (cacheable pnpm install) ----------
FROM node:${NODE_VERSION}-slim AS deps
RUN corepack enable
WORKDIR /repo

# Copy lockfile, workspace manifest, and every workspace package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------- stage 2: build (typecheck + emit) ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @medbridge/contracts run build && \
    pnpm --filter @medbridge/api run build

# ---------- stage 3: runtime ----------
FROM node:${NODE_VERSION}-slim AS runtime
RUN corepack enable && \
    apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Production-only deps
COPY --from=build /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/packages/contracts/package.json ./packages/contracts/
COPY --from=build /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /repo/apps/api/dist ./apps/api/dist

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod --filter @medbridge/api...

USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
