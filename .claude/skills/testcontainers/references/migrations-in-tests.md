# testcontainers — why programmatic `migrate()` in tests

## The apparent contradiction

The `drizzle` skill (Rule 25) says:

> Apply migrations with `pnpm --filter api drizzle-kit migrate`. The long-running `api` service NEVER calls `migrate()` programmatically on boot.

This skill (Rule 9) says:

> Apply schema in `beforeAll` using `migrate(db, { migrationsFolder: ... })` from `drizzle-orm/node-postgres/migrator`.

These are NOT contradictory. The rules apply to different contexts.

## The distinction

| Context | Who applies migrations | How |
|---|---|---|
| Production (compose `api` service) | One-shot `api-migrate` container | `drizzle-kit migrate` CLI, runs to completion, exits 0 before `api` starts |
| Local dev (`pnpm dev`) | Developer, once | `pnpm --filter api drizzle-kit migrate` against the running compose postgres |
| Integration tests | The test process itself | Programmatic `migrate()` from `drizzle-orm/node-postgres/migrator` |

The drizzle rule's intent is "the API server process must not migrate". The test process is not the API server. It is a Vitest worker that needs an empty Postgres to be schema-ready in milliseconds, against a connection string only the test process knows. Shelling out to `drizzle-kit migrate` from `beforeAll` would:

1. Require materializing a `drizzle.config.ts` with the dynamic test connection string — that file is checked into source control and points at the dev DB.
2. Add ~1.5 s of CLI startup per test file.
3. Make migration failures opaque (CLI exit code instead of typed exceptions).

The programmatic `migrate()` consumes the same `apps/api/src/db/migrations/` folder as the CLI does, runs the same SQL in the same order, and verifies success in-process. It is the same migration set — just a different invocation surface.

## What the test must guarantee

1. The migrations folder path is `apps/api/src/db/migrations`. No second migration set anywhere in the tree.
2. `migrate()` is awaited before any query.
3. If a migration adds a new extension (e.g. `pg_trgm`), the image MUST still be `postgres:17-alpine` (which ships `contrib` modules including `pgcrypto`, `pg_trgm`, `citext`, `uuid-ossp`). The Alpine variant does NOT strip these.

## What the test MUST NOT do

- Use `drizzle-kit push` (schema sync without a migration history). The drizzle skill bans `push` for the same reasons it bans auto-migrate on boot: it diverges from production's audit trail.
- Maintain a `tests/migrations/` folder. Always one source of truth.
- Snapshot the post-migrate schema and restore it between tests via `pg_restore`. Slower than `TRUNCATE` and adds a binary tool dependency.

## What the drizzle skill's Rule 25 still forbids

- The `apps/api` long-running server importing `migrate` and calling it in `server.ts` / `app.ts` bootstrap. That is still forbidden. The test process is a different binary, run by Vitest, never deployed.

## Open question: should this skill own the migrate call?

This skill owns the mechanics ("call `migrate()` here, after `start()`, before queries"). The `drizzle` skill owns the migration-file format and the production CLI workflow. The `api-integration-testing` skill owns what data to seed AFTER `migrate()` completes. Three skills, three responsibilities, no overlap.
