# Multi-stage Dockerfile pattern

MedBridge first-party services (`api`, `ui`, `api-migrate`, `seed`) build from multi-stage Dockerfiles. The pattern is consistent across both apps; the runtime stage differs.

## `apps/api/Dockerfile` — Node 25 + Hono + Drizzle

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=25

# ---------- stage 1: deps (cacheable pnpm install) ----------
FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable
WORKDIR /repo

# Copy lockfile, workspace manifest, and every workspace package.json
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
# Add any other workspaces here

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------- stage 2: build (typecheck + emit) ----------
FROM deps AS build
COPY . .
RUN pnpm --filter @medbridge/contracts run build && \
    pnpm --filter @medbridge/api run build
# Output: apps/api/dist/

# ---------- stage 3: runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
RUN corepack enable
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
CMD ["node", "dist/server.js"]
```

Key points:

- `--mount=type=cache` requires BuildKit (default in Docker 27).
- `corepack enable` activates the `packageManager` pin from `package.json`.
- The deps stage only invalidates when lockfiles or `package.json`s change — this is the speed win.
- `--filter @medbridge/api...` (trailing `...`) pulls in upstream workspace deps.
- `USER node` drops root for the runtime process.

## `apps/ui/Dockerfile` — Vite + nginx

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=25

FROM node:${NODE_VERSION}-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/ui/package.json apps/ui/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @medbridge/contracts run build && \
    pnpm --filter @medbridge/ui run build
# Output: apps/ui/dist/

FROM nginx:1.27-alpine AS runtime
COPY apps/ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/ui/dist /usr/share/nginx/html
EXPOSE 80
# Default nginx CMD is fine.
```

`apps/ui/nginx.conf` must serve `index.html` for unknown paths so the SPA router handles routing:

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

## `api-migrate` and `seed` Dockerfile

These services REUSE the `api` image via `image: medbridge/api:dev` in compose. Their `command:` overrides the CMD:

```yaml
api-migrate:
  build: { context: ., dockerfile: apps/api/Dockerfile }
  image: medbridge/api:dev
  command: ["pnpm", "--filter", "@medbridge/api", "run", "db:migrate"]
```

This requires `pnpm` to be on the PATH in the runtime image (it is, via `corepack enable`).

## `.dockerignore`

Place at the repo root:

```
node_modules
**/node_modules
apps/*/dist
packages/*/dist
.git
.env
.env.local
uploads
*.log
.DS_Store
```

Without this, every workspace's `node_modules` is shipped into the build context — a >1 GB slowdown.

## Build invariants

- `--frozen-lockfile` everywhere. The lockfile is canon.
- One `pnpm install` per stage; cache mount makes it cheap.
- No `RUN apt-get ...` / `RUN apk add ...` unless absolutely necessary.
- Pin base images to a minor + variant (`node:25-alpine`, not `node:alpine` and not `node:25`).
