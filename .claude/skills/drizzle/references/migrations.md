# Drizzle Kit migrations workflow

Covers `drizzle-kit generate`, `drizzle-kit migrate`, hand-editing generated SQL, the journal model, and rollback policy.

## Files Drizzle Kit owns

```
apps/api/src/db/migrations/
  0000_init.sql              # generated SQL (can be hand-edited before first commit)
  0001_add_refresh_tokens.sql
  meta/
    _journal.json            # ordered list of migration entries with hashes
    0000_snapshot.json       # schema snapshot after this migration
    0001_snapshot.json
```

`_journal.json` is the source of truth for migration order. Each entry references a snapshot. Drizzle Kit diffs the latest snapshot against the schema barrel to compute the next migration.

## `drizzle.config.ts`

```ts
import type { Config } from "drizzle-kit";

export default {
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,           // confirm dangerous operations
  verbose: true,
} satisfies Config;
```

Run with: `pnpm --filter api drizzle-kit <command>`. Drizzle Kit reads `apps/api/drizzle.config.ts` automatically.

## Generate

```
pnpm --filter api drizzle-kit generate
# or with a name:
pnpm --filter api drizzle-kit generate --name add_refresh_tokens
```

What it does:

1. Reads the schema barrel (`src/db/schema.ts`).
2. Diffs against `meta/<latest>_snapshot.json`.
3. Emits a new `<NNNN>_<name>.sql` file and updates `meta/_journal.json` + `meta/<NNNN>_snapshot.json`.

Commit ALL three changes together: the `.sql`, the journal, and the new snapshot. If you commit only the SQL, the next `generate` will not know it has been processed and will re-emit a redundant migration.

## Migrate

```
pnpm --filter api drizzle-kit migrate
```

What it does:

1. Connects using `dbCredentials.url`.
2. Creates `drizzle.__drizzle_migrations` if missing (the bookkeeping table).
3. Applies every migration in `_journal.json` that is not yet recorded as applied, in order.
4. Records each successful application with its hash.

The `api-migrate` one-shot compose service runs exactly this command and exits 0. The long-running `api` service depends on `api-migrate` having exited successfully.

## Hand-editing migrations

Drizzle Kit emits standard PostgreSQL DDL but cannot express:

- `CREATE EXTENSION` (e.g. `pgcrypto` for `gen_random_uuid()`)
- `CREATE INDEX CONCURRENTLY`
- Custom triggers and functions
- Data backfills mid-migration

For these, hand-edit the generated `.sql` file BEFORE committing. The journal references the file by its filename and hash of its contents — once it has been applied to any environment, the contents are frozen.

Each statement in a Drizzle Kit migration is separated by:

```sql
--> statement-breakpoint
```

The migration runner splits on this marker and submits each chunk as a separate `pg` query. Without the marker, statements are concatenated and a single failure rolls back the entire migration as one — which is what you usually want, except for statements that cannot run inside a transaction (e.g. `CREATE INDEX CONCURRENTLY`).

## Initial migration with `pgcrypto`

```sql
-- 0000_init.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "account" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(255) NOT NULL,
  ...
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_email_uniq" ON "account" ("email");
```

The `CREATE EXTENSION` line is the only manual addition; everything below was emitted by `drizzle-kit generate`. The migration runs inside a transaction by default, which is fine for `CREATE EXTENSION IF NOT EXISTS`.

## Rollback policy

There is no `drizzle-kit down`. Drizzle Kit migrations are forward-only.

To "roll back":

1. Author a new migration that reverses the previous one (`DROP COLUMN`, `DROP TABLE`, etc.).
2. Commit and apply it.

Never edit or delete a migration file that has been merged to `main`. Doing so makes the hash diverge from the recorded value in `__drizzle_migrations` and the next `migrate` will error.

## Local reset

For local dev only:

```
docker compose down -v        # destroy the postgres volume
docker compose up api-migrate # re-create schema from scratch
```

Never do this against a shared environment.

## Verifying the migrations folder

In CI, before running tests:

```
pnpm --filter api drizzle-kit check    # validates _journal.json matches files on disk
pnpm --filter api drizzle-kit generate # exits non-zero if the schema has drifted
```

The second command MUST be a no-op in CI. If it emits a new migration, the PR forgot to commit one.
