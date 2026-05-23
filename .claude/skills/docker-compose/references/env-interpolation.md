# Environment variable interpolation in Compose

Compose interpolates `${VAR}` references inside `docker-compose.yml` before parsing services. Understanding precedence and escaping prevents the two most common bugs: silent empty strings and accidental literal `$` expansion.

## Lookup precedence (highest first)

When Compose resolves `${VAR}` in the YAML:

1. **Shell environment** of the `docker compose` invocation (`export VAR=... && docker compose up`).
2. **`.env` file** in the working directory (same dir as `docker-compose.yml`).
3. **Default** in the interpolation form (`${VAR:-default}`), if any.
4. Empty string (with a warning printed by Compose).

Vars referenced under `services.<svc>.environment:` are then passed INTO the container at runtime. The precedence for what the container actually sees:

1. `environment:` map (highest)
2. `env_file:` listed files (later files override earlier)
3. Image-baked `ENV` directives (lowest)

DO NOT specify the same key in both `environment:` and `env_file:` for one service. The Compose v2 behavior is to let `environment:` win, but the rule is a foot-gun in code review — pick one place.

## Interpolation forms

```yaml
environment:
  # Bare reference: empty + warn if missing
  FOO: ${FOO}

  # Default if unset OR empty
  BAR: ${BAR:-fallback}

  # Default if unset only (empty string passes through)
  BAZ: ${BAZ-fallback}

  # Error if unset OR empty
  QUX: ${QUX:?QUX must be set}

  # Error if unset only
  QUUX: ${QUUX?QUUX must be set}
```

MedBridge convention: use `:?` for any var whose absence makes the service unsafe (DB passwords, JWT secrets). Use `:-` for tunables with a sane default (`NODE_ENV`, `LOG_LEVEL`).

## The `$$` escape

A single `$` in the YAML triggers interpolation. To pass a literal `$` (e.g. for shell expansion INSIDE the container), use `$$`:

```yaml
healthcheck:
  # Inside the container, $POSTGRES_USER expands at probe time, not at compose-parse time.
  test: ["CMD", "pg_isready", "-U", "$$POSTGRES_USER", "-d", "$$POSTGRES_DB"]
```

If you write `$POSTGRES_USER` (single `$`), Compose tries to substitute it from the HOST environment at parse time, which is almost never what you want for a probe command.

## `.env` file syntax

```dotenv
# Comments start with #
POSTGRES_USER=medbridge
POSTGRES_PASSWORD=change-me

# Quotes are literal — they end up in the value
POSTGRES_DB="medbridge"   # value is literally `"medbridge"` (BAD)
POSTGRES_DB=medbridge     # value is `medbridge` (GOOD)

# Multi-line values: use \n escape, not real newlines
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

- No `export` keyword (it is silently tolerated but unnecessary).
- No spaces around `=`. `FOO = bar` becomes a key `FOO ` with value ` bar`.
- Lines starting with `#` are comments.
- No interpolation INSIDE `.env` — `FOO=${OTHER}` is the literal seven-character string.

## `.env.example` discipline

MedBridge MUST ship `.env.example` with EVERY required key:

```dotenv
POSTGRES_USER=medbridge
POSTGRES_PASSWORD=change-me
POSTGRES_DB=medbridge
NODE_ENV=production
JWT_SECRET=change-me
```

- Use safe placeholder values (`change-me`, `localhost`, no real secrets).
- Every key referenced in `docker-compose.yml` (`${...}`) appears in `.env.example`.
- `.env` is git-ignored. `.env.example` is committed.

Wave review rejects any PR adding a `${...}` reference without a matching `.env.example` entry.

## Debugging interpolation

```bash
docker compose config            # print the resolved YAML; check that ${...} expanded as expected
docker compose run --rm api env  # dump env inside an ad-hoc api container
```

Common bug: `docker compose up` succeeds but the app silently uses empty DB credentials. The fix is `${VAR:?}` for required vars — Compose then fails fast.
