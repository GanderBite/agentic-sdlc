# Compose v2 — keys MedBridge uses

Reference for the subset of the Compose Specification this repo touches. The official spec is exhaustive; this file is curated.

## Top-level

```yaml
name: medbridge        # OPTIONAL: project name (overrides directory basename). Used by `docker compose -p`.
services: { ... }      # required
volumes: { ... }       # OPTIONAL: named volumes
networks: { ... }      # OPTIONAL: omitted in MedBridge — default bridge suffices
```

Deprecated and forbidden in MedBridge:

- `version:` — obsolete in v2; the parser warns and ignores it.
- `deploy:` — Swarm-mode only. Single-host deployment does not use Swarm.

## `services.<name>` keys used

| Key                | Type                | Notes                                                                                  |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------- |
| `image`            | string              | Pinned tag. Combine with `build:` to name a locally built image.                       |
| `build`            | map                 | `context` + `dockerfile` (+ `args`, `target`, `cache_from`).                            |
| `command`          | list[string]        | Exec form; overrides Dockerfile `CMD`.                                                 |
| `entrypoint`       | list[string]        | Overrides Dockerfile `ENTRYPOINT`. Rarely needed.                                      |
| `environment`      | map                 | Per-var values, interpolated against host env / `.env`.                                |
| `env_file`         | list[string]        | File path(s); lower precedence than `environment`.                                     |
| `ports`            | list[string]        | `"HOST:CONTAINER"` form. ALWAYS quote.                                                 |
| `expose`           | list[string]        | Internal-only; rarely needed since intra-network DNS works without it.                 |
| `volumes`          | list[string]        | Bind: `./host:/in/ctr`. Named: `name:/in/ctr`. Read-only suffix: `:ro`.                |
| `depends_on`       | map                 | Long-form only: `<peer>: { condition: <cond> }`.                                       |
| `healthcheck`      | map                 | `test`, `interval`, `timeout`, `retries`, `start_period`. See `healthchecks.md`.       |
| `restart`          | string              | `unless-stopped` for long-lived; `"no"` (quoted) for one-shots.                        |
| `profiles`         | list[string]        | Tags that gate the service behind `--profile <tag>`.                                   |
| `user`             | string              | OPTIONAL: `uid:gid`. Use only when the image runs as root and shouldn't.               |
| `working_dir`      | string              | OPTIONAL.                                                                              |
| `init`             | bool                | OPTIONAL: zombie-reaper init. Rarely needed for Node images.                           |

## `depends_on` conditions (exhaustive)

```yaml
depends_on:
  postgres:
    condition: service_healthy            # peer reports `healthy`
  api-migrate:
    condition: service_completed_successfully   # peer exited 0 (one-shots only)
  some-other:
    condition: service_started            # peer container created; no health guarantee
```

The condition values above are the ENTIRE valid set. There is no `service_unhealthy`, no `service_failed`, no `service_exited`.

## `build` keys

```yaml
build:
  context: .
  dockerfile: apps/api/Dockerfile
  args:                       # OPTIONAL: build-time ARGs, NOT runtime env
    NODE_VERSION: "25"
  target: runtime             # OPTIONAL: multi-stage target
  cache_from:                 # OPTIONAL: registry image as build cache
    - medbridge/api:cache
```

Notes:

- `args` are NOT visible at runtime. Use `environment:` for runtime values.
- `target` selects a multi-stage target. Default is the last stage.
- BuildKit is on by default in Docker 27.

## `extends:` (used only if a service needs to inherit)

MedBridge currently does NOT use `extends:`. The four first-party services share an image via `image: medbridge/api:dev` instead, which is simpler and avoids the cross-file include traps of `extends`.

## What this repo deliberately does NOT use

- `configs:` and `secrets:` top-level keys — Swarm-oriented; single-host doesn't need them. `.env` + `environment:` covers dev secrets.
- `deploy:` — Swarm only.
- `networks:` custom topologies — default bridge is fine.
- `tmpfs:` — no use case yet.
- `cap_add` / `cap_drop` / `privileged` — none of our services need elevated privileges.
- `sysctls`, `ulimits` — defaults suffice.
- `links:` — legacy v1; v2 uses DNS via the bridge network.

If a wave needs one of these, document the reason in the PR description before adding it.

## Authoritative source

Compose Specification — github.com/compose-spec/compose-spec (read the spec markdown in the repo for keys not covered here).
