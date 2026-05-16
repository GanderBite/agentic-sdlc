# Healthcheck recipes

Exact `healthcheck:` blocks per service. SKILL.md uses `<svc-...-url>` placeholders; this file gives the literal strings.

## Timing baseline (MedBridge default)

```yaml
healthcheck:
  test: [...]
  interval: 5s         # how often to probe once running
  timeout: 3s          # per-probe deadline
  retries: 10          # consecutive failures before `unhealthy`
  start_period: 10s    # grace window after container start; failures here don't count
```

Adjust `start_period` per service if cold-start is slow:

| Service     | `start_period` | Reason                                         |
| ----------- | -------------- | ---------------------------------------------- |
| `postgres`  | `30s`          | Initial `initdb` of an empty data volume       |
| `api`       | `10s`          | Node 25 startup + Drizzle pool warmup          |
| `ui`        | `5s`           | nginx serves static files; near-instant ready  |

## postgres

```yaml
healthcheck:
  test: ["CMD", "pg_isready", "-U", "$$POSTGRES_USER", "-d", "$$POSTGRES_DB"]
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 30s
```

- `$$` escapes Compose's `${...}` interpolation so the variable resolves INSIDE the container at probe time.
- `pg_isready` ships in `postgres:17-alpine` at `/usr/local/bin/pg_isready`.
- Exit 0 = accepting connections. Exit 1 = rejecting. Exit 2 = no response. Exit 3 = client error.

## api (Node + Hono)

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/healthz"]
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 10s
```

- `wget` is in BusyBox, which ships in `node:25-alpine`. No extra `apk add` needed.
- `-q` silences stdout; `-O-` writes to stdout (so `wget` exits non-zero on HTTP >=400).
- `/healthz` MUST be a simple `200 OK` route in `apps/api/src/routes/health.ts`. It MUST NOT depend on Postgres for liveness (Postgres has its own healthcheck).
- If you switch to `node:25-bookworm-slim`, replace `wget` with `curl -fsS http://127.0.0.1:3000/healthz` and add `curl` in the Dockerfile.

## ui (nginx)

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://127.0.0.1/"]
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 5s
```

- `nginx:1.27-alpine` has `wget` via BusyBox.
- Probes the root, which serves `index.html`.

## When to use `CMD-SHELL`

Only when you need shell features (pipes, redirects, `&&`). Form:

```yaml
test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER || exit 1"]
```

In MedBridge, prefer the exec form (`["CMD", ...]`) for all four production probes.

## Verifying a healthcheck

```bash
docker compose ps                    # STATE column shows "healthy" / "unhealthy" / "starting"
docker inspect --format '{{ json .State.Health }}' "$(docker compose ps -q api)" | jq .
docker compose logs api              # if unhealthy, the probe output is the first place to look
```

## What fails the linter

The SKILL.md linter forbids `http(s)://` strings in `.claude/skills/<skill>/SKILL.md`. Literal probe URLs live HERE in references/. SKILL.md uses placeholders (`<api-healthz-url>`, `<ui-root-url>`) and points readers to this file for the exact form.
