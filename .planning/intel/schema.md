# Database schema

Snapshot: `1c8d5d1707e5aa47d37c987e847cd6ae0fcc2a41`.

Derived from `apps/api/src/db/schema.ts` (barrel),
`apps/api/src/modules/{accounts,auth}/schema.ts`, and
`apps/api/src/db/migrations/0000_init.sql`.

## Tooling

- **Database**: PostgreSQL 17 (`postgres:17-alpine` in `docker-compose.yml`).
- **Driver**: `pg` (`Pool`); pool config in `apps/api/src/shared/db.ts`
  (`max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`).
- **ORM**: Drizzle ORM (`drizzle-orm@^0.38.4`, adapter
  `drizzle-orm/node-postgres`).
- **Migration tool**: Drizzle Kit (`drizzle-kit@^0.30.6`).
- **Drizzle config**: `apps/api/drizzle.config.ts`
  (`dialect: 'postgresql'`, `schema: './src/db/schema.ts'`,
  `out: './src/db/migrations'`, `dbCredentials.url` from `DATABASE_URL`).
- **Schema barrel**: `apps/api/src/db/schema.ts` re-exports
  `modules/accounts/schema.js` and `modules/auth/schema.js` so drizzle-kit
  introspects every table in one import.
- **Migrations folder**: `apps/api/src/db/migrations/` — statement-breakpointed
  SQL plus `meta/_journal.json`. Apply with
  `pnpm -F @medbridge/api drizzle:migrate`; generate with
  `pnpm -F @medbridge/api drizzle:generate`.

## Required Postgres extensions

Created in `0000_init.sql`:

- `pgcrypto` — for `gen_random_uuid()` PK defaults.
- `citext` — for case-insensitive `email`. The Drizzle column type is provided
  by a local `customType<{ data: string }>({ dataType: () => 'citext' })`
  helper in `modules/accounts/schema.ts`.

## Tables

### `user`

Module: `apps/api/src/modules/accounts/schema.ts`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()`, NOT NULL |
| `email` | `citext` | NOT NULL, UNIQUE (`user_email_unique`) |
| `role` | `user_role` (enum) | NOT NULL |
| `password_hash` | `text` | NOT NULL (argon2id digest) |
| `created_at` | `timestamp with time zone` | NOT NULL, `DEFAULT now()` |
| `deleted_at` | `timestamp with time zone` | NULL — soft delete sentinel |

Enum `user_role`: `'patient'`, `'doctor'`.

Read pattern: `findUserByEmail(db, email)` in `modules/auth/repo.ts` filters
`isNull(user.deletedAt)`, so soft-deleted users are invisible to login.

### `refresh_token`

Module: `apps/api/src/modules/auth/schema.ts`.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()`, NOT NULL |
| `user_id` | `uuid` | NOT NULL, FK → `user(id)` `ON DELETE RESTRICT` |
| `token_hash` | `text` | NOT NULL, UNIQUE (`refresh_token_token_hash_unique`) |
| `issued_at` | `timestamp with time zone` | NOT NULL, `DEFAULT now()` |
| `expires_at` | `timestamp with time zone` | NOT NULL |
| `revoked_at` | `timestamp with time zone` | NULL |

`token_hash` stores a sha256 hex digest of the raw refresh-token cookie
value (see `main.ts:hashRefreshToken`). The plaintext token is never
persisted.

Relations: `refresh_token.user` → `user` (one-to-one drizzle relation).

## Migrations applied

`apps/api/src/db/migrations/meta/_journal.json`:

| idx | tag | when (ms) | breakpoints |
|---|---|---|---|
| 0 | `0000_init` | 1748000000000 | true |

`0000_init.sql` creates both extensions, the `user_role` enum, both tables,
the unique indexes implied by the unique columns, and the
`refresh_token.user_id → user.id` foreign key with
`ON DELETE RESTRICT ON UPDATE NO ACTION`.

## Invariants

- **Soft delete** on `user.deleted_at` — all `findUserByEmail` queries filter
  it out. No other table has `deleted_at` yet.
- **No plaintext secrets at rest**: passwords are argon2id digests;
  refresh-token rows store a sha256 hash of the cookie value.
- **Restrict deletes**: `refresh_token.user_id` uses `ON DELETE RESTRICT` so a
  user with active refresh tokens cannot be hard-deleted accidentally. The
  intended deletion path is soft-delete via `user.deleted_at`.
- **Forward-only migrations** — there is no rollback path. Generate a new
  migration to reverse a change, never edit an applied SQL file.
- **Boot order in `docker-compose.yml`**: `postgres` → `api-migrate`
  (runs `drizzle:migrate`, exits) → `api`.

## Planned but not yet on disk

Per `docs/APPLICATION.md` the eventual MedBridge schema adds:
`doctor_profile`, `patient_profile`, `specialization`, `slot`, `appointment`,
`medical_record`, `medical_document`, `appointment_document`. None of these
tables exist yet — they will be added in subsequent sprints. When they land,
re-run `intel-refresh` so this file is repopulated from the real schema.
