# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=25

# ---------- stage 1: build (pnpm install + vite build) ----------
FROM node:${NODE_VERSION}-slim AS build
RUN corepack enable
WORKDIR /repo

# Copy lockfile, workspace manifest, and every workspace package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/ui/package.json apps/ui/
COPY packages/contracts/package.json packages/contracts/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @medbridge/ui run build

# ---------- stage 2: serve (nginx static) ----------
FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/ui/dist /usr/share/nginx/html
COPY apps/ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
