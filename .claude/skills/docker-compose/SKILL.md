<!-- version: 1.0.0 -->

# docker-compose

## Purpose

Rules for the single `docker-compose.yml` at the repo root that runs MedBridge on one host: Compose v2 syntax, service definitions for `ui` / `api` / `postgres` / `api-migrate` / `seed`, `depends_on` conditions, healthchecks, one-shot service patterns, named volumes vs bind mounts, `.env` interpolation, and the `docker compose` CLI. Encodes WHAT a correct compose file and invocation look like — never WHEN to deploy.

## Consumers

- `task-builder` — writes/edits `docker-compose.yml`, service-level `Dockerfile`s, and `.env.example`.
- `wave-reviewer` — verifies dependency ordering, healthchecks, volume types, and `.env` hygiene.
- `verification-gates` author — wires `docker compose up --wait` and one-shot exit codes into CI.

## Rules

The full reference (compose v2 spec, healthcheck recipes, image-vs-build deep dive, Dockerfile interplay) lives in `references/`.

### CLI + tooling

1. Use the v2 plugin form `docker compose` (space). Never `docker-compose` (hyphen, v1, EOL).
2. Require Docker Engine `27.x` or newer. Compose v2 ships with the Docker CLI; do not install a standalone binary.
3. Run all `docker compose` commands from the directory containing `docker-compose.yml` (the repo root). Use `-f <path>` only when overriding from elsewhere; never to point at a non-root file by convention.
4. Use `docker compose up -d --wait` in CI and scripts to block until every service is `running` or `healthy`. Plain `up -d` returns before healthchecks pass.
5. Use `docker compose down -v` only when you intend to delete named volumes (data loss). Plain `down` preserves volumes.

### File shape

6. Omit the top-level `version:` key. Compose v2 ignores it and warns on its presence.
7. Top-level keys allowed in this repo: `services`, `volumes`, `networks` (OPTIONAL), `name` (OPTIONAL, project name). No other top-level keys.
8. Use 2-space indentation. Quote every string that contains `:`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `#`, `?`, `|`, `-`, `<`, `>`, `=`, `!`, `%`, `@`, or backtick. Quote ALL `healthcheck.test` shell strings.
9. Service names use lowercase kebab-case and match the canonical set: `ui`, `api`, `postgres`, `api-migrate`, `seed`. Adding a new service requires a docs update.

### Image vs build

10. Use `image:` for upstream images (`postgres:17-alpine`, `nginx:1.27-alpine`). Pin to an exact minor + variant; never `latest`, never an unpinned tag.
11. Use `build:` for first-party services (`ui`, `api`, `api-migrate`, `seed`). The build context is the repo root; the `Dockerfile` lives at the service's directory (e.g. `apps/api/Dockerfile`).
12. Combine `build:` with `image:` to name the locally built image (`image: medbridge/api:dev`). This lets `docker compose up` reuse the cached image without rebuild and lets `--build` force a rebuild.
13. `docker compose up` does NOT rebuild changed sources by default. Use `docker compose up --build` after any change inside `apps/api`, `apps/ui`, `packages/*`, or a `Dockerfile`. Use `docker compose build --no-cache <svc>` to bust the cache.
14. Every first-party `Dockerfile` MUST be multi-stage: a `deps` stage (pnpm install with `--frozen-lockfile`), a `build` stage (typecheck + emit), and a minimal `runtime` stage (`node:25-alpine` or `nginx:1.27-alpine`). See `references/dockerfile.md`.

### `depends_on` conditions

15. Use the long-form `depends_on:` map with explicit `condition:`. Never use the short-form list. Valid conditions are EXACTLY:
    - `service_started` — peer container has been created and started; no health guarantee.
    - `service_healthy` — peer container's `healthcheck` reports `healthy`. Requires the peer to define `healthcheck:`.
    - `service_completed_successfully` — peer container exited with code `0`. Only valid for one-shot services (`restart: "no"`).
16. `api`, `api-migrate`, and `seed` MUST wait on `postgres` with `condition: service_healthy`.
17. `seed` MUST wait on `api-migrate` with `condition: service_completed_successfully`.
18. `ui` MUST NOT depend on `api` in compose. The browser calls `api` over HTTP; in-container ordering would force a rebuild loop and is not needed for static-asset serving.

### Healthchecks

19. Every long-lived service (`postgres`, `api`, `ui`) MUST define a `healthcheck:`. One-shot services (`api-migrate`, `seed`) MUST NOT.
20. Use `test: ["CMD", "<binary>", "<args>..."]` form (exec form). Never `CMD-SHELL` unless shell features (pipes, redirects) are required, in which case quote the whole command as one string and prefix with `CMD-SHELL`.
21. Healthcheck timing for this repo: `interval: 5s`, `timeout: 3s`, `retries: 10`, `start_period: 10s`. Adjust `start_period` per service if cold-start dominates (Postgres data dir init: `30s`).
22. Postgres healthcheck MUST use `pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"`. The doubled `$$` escapes Compose interpolation so the variable expands inside the container.
23. Loopback-probe healthchecks (api, ui) MUST target `127.0.0.1` over the container's listening port using `wget -qO-` (alpine) or `curl -fsS` (debian). Full recipes with the literal URL form live in `references/healthchecks.md`.

### One-shot services

24. `api-migrate` and `seed` MUST set `restart: "no"` (quoted; bare `no` is parsed as YAML boolean false). They MUST exit on completion.
25. One-shot services MUST NOT define `healthcheck:`, `ports:`, or `expose:`.
26. The entrypoint for `api-migrate` is `pnpm --filter @medbridge/api run db:migrate` (drizzle-kit migrate). For `seed`, `pnpm --filter @medbridge/api run db:seed`. Both reuse the `api` image via `image: medbridge/api:dev` plus `build:` so they rebuild atomically with `api`.
27. Start one-shots explicitly with `docker compose up api-migrate` (or `seed`). Compose v2 streams exit code; non-zero fails the wave. To run on every `up`, list them as `depends_on` of a service that ALWAYS starts (typically `api`).

### Volumes

28. Use a NAMED volume for Postgres data: `postgres_data:/var/lib/postgresql/data`. Declare it under the top-level `volumes:` key. Never bind-mount the Postgres data dir; permission semantics differ across hosts.
29. Use a BIND mount for the host-shared `uploads/` document blob directory: `./uploads:/app/uploads`. The host path is relative to `docker-compose.yml`. Add `uploads/` to `.gitignore`.
30. Never bind-mount source code into the `api` or `ui` runtime images in compose. Source changes go through `--build`. (Hot reload during local dev is `pnpm dev` outside compose, not inside it.)
31. Named volumes declared at top-level MUST have an empty body (`postgres_data:`) unless overriding driver options. Do not set `external: true` for repo-local volumes.

### Environment + `.env`

32. Compose reads `.env` from the same directory as `docker-compose.yml` automatically. Reference vars in YAML with `${VAR}` or `${VAR:-default}`. Vars without a default that are missing at runtime are passed as empty strings and warn.
33. Commit `.env.example` with every required key and a placeholder value. Add `.env` to `.gitignore`. Never commit a populated `.env`.
34. Pass env into a container with `environment:` (map) or `env_file:` (path). Do not mix both for the same key in the same service; precedence is brittle.
35. Use `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}` (mandatory form) for any var whose absence makes the service unsafe. Compose exits before starting.
36. Never echo secrets into `command:` or `entrypoint:` arrays; they appear in `docker compose config` output and `docker inspect`. Pass via `environment:` only.

### Networking

37. Compose v2 auto-creates one default bridge network per project, named `<project>_default`. Services reach each other by SERVICE NAME as the hostname (`postgres`, `api`). Do not hardcode container IPs.
38. Publish a host port ONLY for services humans hit directly: `ui` (`"8080:80"`), `api` (`"3000:3000"` during local dev). `postgres` MUST NOT publish a host port in committed compose; use `docker compose exec postgres psql` for ad-hoc access.
39. Use string-quoted port mappings (`"3000:3000"`). Bare `3000:3000` is parsed as base-60 by YAML and silently mangled.
40. Do not define custom `networks:` for this single-host deployment. The default bridge is sufficient.

### Profiles

41. Use `profiles:` to keep one-shot services out of the default `docker compose up` run. Tag `seed` (and any future fixture/loader) with `profiles: ["seed"]`. Invoke with `docker compose --profile seed up seed`.
42. `api-migrate` MUST NOT be profiled. It runs on every `up` so the schema matches the running image.

## Format — `docker-compose.yml` (annotated, MedBridge canonical)

```yaml
name: medbridge                                   # OPTIONAL: project name; defaults to dir name

services:
  postgres:                                       # required
    image: postgres:17-alpine                     # required; pinned
    environment:                                  # required
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
      POSTGRES_DB: ${POSTGRES_DB:-medbridge}
    volumes:
      - postgres_data:/var/lib/postgresql/data    # named volume
    healthcheck:                                  # required for long-lived
      test: ["CMD", "pg_isready", "-U", "$$POSTGRES_USER", "-d", "$$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s
    restart: unless-stopped                       # OPTIONAL

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    image: medbridge/api:dev                      # name the built image
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-medbridge}
      NODE_ENV: ${NODE_ENV:-production}
    ports:
      - "3000:3000"
    volumes:
      - ./uploads:/app/uploads                    # bind mount: document blobs
    depends_on:
      postgres:
        condition: service_healthy
      api-migrate:
        condition: service_completed_successfully
    healthcheck:                                  # loopback /healthz; see references/healthchecks.md
      test: ["CMD", "wget", "-qO-", "<api-healthz-url>"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    restart: unless-stopped

  api-migrate:                                    # one-shot
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    image: medbridge/api:dev                      # reuse api image
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-medbridge}
    command: ["pnpm", "--filter", "@medbridge/api", "run", "db:migrate"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"                                 # quoted; bare `no` is boolean false

  seed:                                           # one-shot, profiled
    profiles: ["seed"]
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    image: medbridge/api:dev
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-medbridge}
    command: ["pnpm", "--filter", "@medbridge/api", "run", "db:seed"]
    depends_on:
      api-migrate:
        condition: service_completed_successfully
    restart: "no"

  ui:
    build:
      context: .
      dockerfile: apps/ui/Dockerfile
    image: medbridge/ui:dev
    ports:
      - "8080:80"
    healthcheck:                                  # loopback root; see references/healthchecks.md
      test: ["CMD", "wget", "-qO-", "<ui-root-url>"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s
    restart: unless-stopped

volumes:
  postgres_data:                                  # named, repo-local
```

Placeholders `<api-healthz-url>` and `<ui-root-url>` are replaced with the literal loopback URLs documented in `references/healthchecks.md`. The annotated YAML uses placeholders so this file stays URL-free; the references file gives the exact strings.

## `.env.example` shape

```dotenv
POSTGRES_USER=medbridge
POSTGRES_PASSWORD=change-me
POSTGRES_DB=medbridge
NODE_ENV=production
```

## Examples

### CORRECT — start the stack and run migrations to a healthy state

```bash
docker compose up -d --wait
# Streams logs of all services; blocks until each long-lived service is healthy.
# `api-migrate` runs as an `api` dependency, exits 0, then `api` starts.

docker compose ps
docker compose logs -f api
docker compose exec postgres psql -U medbridge -d medbridge
```

### CORRECT — load fixtures via the profiled `seed` service

```bash
docker compose --profile seed up seed
# Exits when `seed` exits; non-zero propagates.
```

### CORRECT — rebuild after touching `apps/api/src/`

```bash
docker compose up -d --build api api-migrate
```

### INCORRECT — legacy CLI form

```bash
docker-compose up -d
```

Violates Rule 1 (v1 CLI, EOL). FIX: `docker compose up -d`.

### INCORRECT — bare boolean in `restart` for a one-shot

```yaml
api-migrate:
  restart: no                   # parsed as YAML false
```

Violates Rule 24. FIX: `restart: "no"`.

### INCORRECT — short-form `depends_on`

```yaml
api:
  depends_on:
    - postgres
    - api-migrate
```

Violates Rule 15 (no `condition:`). `api` will boot before Postgres is accepting connections AND before migrations have run. FIX: use the long-form map with `service_healthy` and `service_completed_successfully`.

### INCORRECT — bind-mounting Postgres data

```yaml
postgres:
  volumes:
    - ./pgdata:/var/lib/postgresql/data
```

Violates Rule 28. Host UID/GID mismatch corrupts the data dir on Linux; macOS has performance + permission penalties. FIX: named volume `postgres_data:/var/lib/postgresql/data`.

### INCORRECT — unquoted port mapping

```yaml
api:
  ports:
    - 3000:3000
```

Violates Rule 39. YAML parses `3000:3000` as a base-60 integer. FIX: `"3000:3000"`.

### INCORRECT — `up` instead of `up --wait` in CI

```bash
docker compose up -d
pnpm --filter @medbridge/api test:integration   # may race the DB
```

Violates Rule 4. FIX: `docker compose up -d --wait` before integration tests.

## Deeper reference

- `references/compose-spec.md` — full Compose v2 keys MedBridge uses (long-form `depends_on`, `profiles`, `extends`, `configs`, `secrets`), versions, and what is deliberately excluded (swarm, deploy.replicas).
- `references/healthchecks.md` — recipe table per image: postgres (`pg_isready`), nginx (`wget`), node (`/healthz` route), with the LITERAL loopback URLs and timing rationale.
- `references/dockerfile.md` — the multi-stage pattern for `apps/api` and `apps/ui`: pnpm fetch with cache mount, `--frozen-lockfile`, `tsc -b` then `node:25-alpine` for api, `vite build` then `nginx:1.27-alpine` for ui.
- `references/cli.md` — `docker compose up/down/ps/logs/exec/build/run/config` flags this repo uses, including `--wait`, `--build`, `--profile`, `--no-deps`.
- `references/env-interpolation.md` — precedence of `.env`, shell env, `env_file:`, `environment:`; the `${VAR:?msg}` and `${VAR:-default}` forms; the `$$` literal escape.

## Glossary

- **Compose v2** — the Go-based `docker compose` plugin that replaced the Python `docker-compose` v1 binary. Same YAML, stricter parser, native to the Docker CLI.
- **One-shot service** — a service that runs to completion and exits, with `restart: "no"`. Used here for `api-migrate` and `seed`.
- **Healthcheck** — a per-service command Docker runs on an interval to decide `healthy` vs `unhealthy`. Required for `service_healthy` peers.
- **Named volume** — a Docker-managed volume identified by name (`postgres_data`), portable across hosts and survived by `down` without `-v`.
- **Bind mount** — a host path mounted into a container (`./uploads:/app/uploads`). Tied to the host filesystem; not portable.
- **Profile** — a tag (`profiles: ["seed"]`) that excludes a service from default `up` unless invoked with `--profile <name>`.
