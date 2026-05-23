# @medbridge/api

Backend HTTP API for MedBridge, built with Hono 4 on Node 25.

## Running locally

Start the dev server (uses `tsx --watch`):

```sh
pnpm -F @medbridge/api dev
```

The server listens on `http://localhost:3000` by default. Set `PORT` in your environment to override.

## Database migrations

Apply all pending migrations against the database pointed to by `DATABASE_URL`:

```sh
pnpm -F @medbridge/api drizzle:migrate
```

Generate a new migration after changing a schema file:

```sh
pnpm -F @medbridge/api drizzle:generate
```

Commit both the generated `.sql` file and the `src/db/migrations/meta/` snapshot in the same commit.

## Integration tests

```sh
pnpm -F @medbridge/api test:integration
```

Integration tests spin up a throwaway Postgres instance via Testcontainers, apply migrations, and run against the real database. `DATABASE_URL` does not need to be set — the test harness sets it automatically.

## Seed credentials

The seed script (`pnpm -F @medbridge/api db:seed`) inserts the following deterministic accounts. Use these email/password pairs to log in via the UI or to call authenticated API endpoints during local development.

| Email | Password | Role |
|---|---|---|
| `patient@medbridge.test` | `patientpass123!` | `patient` |
| `doctor@medbridge.test` | `doctorpass123!` | `doctor` |

These accounts are recreated idempotently on every seed run — running the seed multiple times is safe.
