# testcontainers — lifecycle, timeouts, and Docker socket details

## Per-file lifecycle

```
beforeAll (≥60s timeout)
  ├─ new PostgreSqlContainer('postgres:17-alpine')
  ├─ .withReuse() if !CI
  ├─ .start()                          ← pulls image on first run, ~10-30s; ~3-6s warm
  ├─ pg.Pool(getConnectionUri())
  ├─ drizzle(pool, { schema })
  └─ migrate(db, { migrationsFolder })  ← ~200-800ms

  describe / it...
    ├─ beforeEach: TRUNCATE ... RESTART IDENTITY CASCADE
    └─ test body

afterAll (≥30s timeout)
  ├─ pool.end()                         ← MUST precede stop(); open clients block shutdown
  └─ container.stop()                    ← ~1-2s; testcontainers daemon may keep image cached if reuse enabled
```

## Timeout tuning rationale

| Phase | Cold | Warm (reuse) | Why |
|---|---|---|---|
| `start()` first run on a fresh runner | 10–30 s | n/a | docker pulls `postgres:17-alpine` (~80 MB compressed) |
| `start()` subsequent run, no reuse | 3–6 s | n/a | container creation + postgres bootstrap + health probe |
| `start()` with reuse | n/a | 100–300 ms | testcontainers reattaches to the surviving container |
| `migrate()` against ~20 migration files | 200–800 ms | 200–800 ms | one transaction per migration; pgcrypto extension load is one-time |
| `pool.end()` | 50–200 ms | 50–200 ms | drains in-flight queries |
| `container.stop()` | 1–2 s | n/a | SIGTERM, wait, SIGKILL |
| `container.stop()` with reuse | < 100 ms | < 100 ms | container kept alive in background |

Vitest's default 5_000 ms hook timeout is insufficient for a cold pull. `beforeAll(fn, 60_000)` accommodates the worst case (first CI run, slow registry mirror). `afterAll(fn, 30_000)` covers pool drain + stop.

## Error taxonomy

| Symptom | Likely cause | Fix |
|---|---|---|
| `Error: Could not connect to Docker` | Docker daemon not running, or socket path wrong | Start Docker Desktop / `systemctl start docker`; on Colima, export `DOCKER_HOST=unix://${HOME}/.colima/default/docker.sock` |
| `Error: Pull access denied for postgres` | Air-gapped CI, registry mirror down | Pre-pull image in CI step before `pnpm test`: `docker pull postgres:17-alpine` |
| `error: relation "<table>" does not exist` during a test | `migrate()` skipped or pointed at the wrong folder | Verify `migrationsFolder` resolves to `apps/api/src/db/migrations` and that `await migrate(...)` is awaited before any query |
| `error: extension "pgcrypto" is not available` | Image is not `postgres:17-alpine` (some slim images strip contrib) | Pin to `postgres:17-alpine` per Rule 2 |
| Test hangs at `afterAll` | Pool not closed before `container.stop()` | Reorder: `await pool.end()` then `await container.stop()` |
| `Error: container already exists with name ...` | Stale reuse container, schema-incompatible after a migration was added | `docker rm -f $(docker ps -aq --filter "label=org.testcontainers.reuse-hash")` and re-run |

## Docker socket configuration

The `@testcontainers/postgresql` module auto-discovers the Docker socket via the `testcontainers` core library. The discovery order is:

1. `DOCKER_HOST` env var
2. `~/.docker/contexts/meta/...` (Docker Desktop contexts)
3. Default platform socket: `/var/run/docker.sock` on Linux/macOS, named pipe on Windows

For Colima or Rancher Desktop users, set `DOCKER_HOST` in `.env.test` (gitignored). For Lima, set `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal` if the Lima VM cannot resolve the host gateway.

## Why a single pool

A second `pg.Pool` against the same container shares no client cache and competes for the container's `max_connections=100` default. Tests typically need 1–5 concurrent connections; one pool with default `max=10` is sufficient and matches the production code path, which also uses a single pool per process.

## Reuse caveats

`.withReuse()` keys the container by a hash of (image, exposed ports, env, copied files, etc.). If you change any container construction parameter, the next test run starts a NEW container and the OLD one persists. Periodically prune with:

```
docker ps -a --filter "label=org.testcontainers.reuse-hash" --format '{{.ID}} {{.CreatedAt}}'
docker rm -f <ids-older-than-1-day>
```

This is acceptable for developer machines. CI MUST NOT enable reuse (Rule 17).
