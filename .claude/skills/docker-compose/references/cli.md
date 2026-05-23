# `docker compose` CLI reference (v2)

The subcommands and flags MedBridge uses, in the order an operator typically reaches for them.

## Daily operations

```bash
docker compose up -d --wait              # start everything; block until healthy/started
docker compose up -d --build             # rebuild changed images, then up
docker compose up -d --no-deps api       # restart `api` only, do not touch deps
docker compose up api-migrate            # run a one-shot (foreground, exit code propagates)
docker compose --profile seed up seed    # invoke a profiled one-shot

docker compose down                      # stop + remove containers; KEEP volumes
docker compose down -v                   # also remove named volumes (DATA LOSS)
docker compose down --rmi local          # also remove locally built images

docker compose ps                        # service status, health column
docker compose logs -f                   # tail all services
docker compose logs -f api postgres      # tail named services
docker compose logs --since 5m api       # last 5 minutes

docker compose exec api sh               # interactive shell in a running container
docker compose exec postgres psql -U medbridge -d medbridge
docker compose run --rm api-migrate      # ad-hoc one-off run; --rm cleans up
```

## Build management

```bash
docker compose build                     # build all services that have `build:`
docker compose build api                 # build one
docker compose build --no-cache api      # bust the cache for one service
docker compose build --pull              # also re-pull base images
```

`docker compose up --build` is the common shorthand for "rebuild changed services, then up". Use this after any source change.

## Inspection

```bash
docker compose config                    # print the resolved YAML after interpolation
docker compose config --services         # list service names
docker compose config --profiles         # list defined profiles
docker compose top                       # `ps -ef` per running service
docker compose port api 3000             # show host:port for container port
```

## Profiles

```bash
docker compose --profile seed up         # adds `seed`-profiled services to the default set
docker compose --profile seed --profile fixtures up   # combine profiles
```

A profiled service runs ONLY when its profile is active, EXCEPT when listed as a `depends_on` of an active service.

## `--wait` semantics (CI gate)

```bash
docker compose up -d --wait --wait-timeout 120
```

- Returns 0 only when every service is `running` (no healthcheck) or `healthy` (with healthcheck).
- Returns non-zero on timeout (default `--wait-timeout` is per-service; use the flag to bound the wall clock).
- A service with `restart: "no"` that has EXITED `0` also satisfies `--wait`.

Pair `--wait` with one-shots:

```bash
docker compose up -d --wait              # api-migrate is in api's depends_on; runs to completion
docker compose run --rm seed             # explicit, blocks on exit code
```

## Cleanup

```bash
docker compose down -v --remove-orphans  # FULL reset: containers, volumes, orphan services
docker system prune                      # global Docker cleanup (NOT compose-specific)
docker volume ls --filter "label=com.docker.compose.project=medbridge"
docker volume rm medbridge_postgres_data
```

## Useful environment variables

| Var                       | Purpose                                                             |
| ------------------------- | ------------------------------------------------------------------- |
| `COMPOSE_PROJECT_NAME`    | Override project name (default: dir basename or `name:` key).       |
| `COMPOSE_FILE`            | Colon-separated list of compose files. Avoid; use `-f` explicitly.  |
| `COMPOSE_PROFILES`        | Comma-separated profiles to activate without `--profile`.           |
| `DOCKER_BUILDKIT`         | Already `1` in Docker 27; do not unset.                             |
| `COMPOSE_BAKE`            | `true` enables `docker buildx bake` for parallel builds (advanced). |

## Forbidden in MedBridge

- `docker compose pause` / `unpause` — diagnostics-only, not part of normal workflow.
- `docker compose scale` — Swarm/replica concept; we run one of each service.
- `docker-compose <anything>` — v1 CLI; removed from MedBridge dev environments.
