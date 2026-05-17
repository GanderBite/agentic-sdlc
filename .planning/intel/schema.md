# Database schema

Snapshot: `698a63298ece745c06d57a56a863284313daa83f`. Derived from `apps/api/src/modules/auth/schema.ts`, `apps/api/src/db/migrations/0000_initial.sql`, and `apps/api/drizzle.config.ts`.

## Tooling

- **Database**: PostgreSQL 17 (`docker-compose.yml → postgres` service uses `postgres:17-alpine`).
- **Driver**: `pg` (`Pool`); ORM is **Drizzle ORM** with the `drizzle-orm/node-postgres` adapter (`apps/api/src/db/client.ts`).
- **Migration tool**: **Drizzle Kit** (`drizzle-kit` v0.30.x), configured by `apps/api/drizzle.config.ts`.
- **Migration files**: `apps/api/src/db/migrations/*.sql` (statement-breakpointed), metadata in `apps/api/src/db/migrations/meta/`.
- **Schema source**: `apps/api/src/db/schema.ts` (barrel) re-exports `apps/api/src/modules/auth/schema.ts`. Module-owned schema fragments are the rule — `db/schema.ts` should stay a thin re-export aggregator.

## Commands

| Action | Command |
|---|---|
| Generate migration from schema diff | `pnpm --filter @medbridge/api exec drizzle-kit generate` |
| Apply migrations | `pnpm --filter @medbridge/api exec drizzle-kit migrate` |
| Inspect schema | `pnpm --filter @medbridge/api exec drizzle-kit studio` |

`DATABASE_URL` must be set; the compose `api-migrate` service supplies it and runs `pnpm drizzle-kit migrate && node dist/seed/main.js` on each boot.

## Extensions

The initial migration enables:

- `pgcrypto` — used by `gen_random_uuid()` for `id` defaults.
- `citext` — used for `user.email` (case-insensitive equality without `LOWER()` wrapping). A custom Drizzle column type (`citext`) is declared in `modules/auth/schema.ts` to keep typings honest.

## Tables

### `user`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PRIMARY KEY, default `gen_random_uuid()` |
| `email` | `citext` | NOT NULL, UNIQUE (`user_email_unique`) |
| `role` | `text` | NOT NULL, CHECK `role IN ('patient', 'doctor')` (`user_role_check`) |
| `password_hash` | `text` | NOT NULL (argon2id digest) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |
| `deleted_at` | `timestamptz` | NULL — soft-delete marker |

Drizzle relation: `user.refreshTokens` → many `refresh_token`.

### `refresh_token`

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | PRIMARY KEY, default `gen_random_uuid()` |
| `user_id` | `uuid` | NOT NULL, FK → `user.id` ON DELETE RESTRICT |
| `hash` | `text` | NOT NULL, UNIQUE (`refresh_token_hash_unique`) — sha256 of the cookie value, never stored in plaintext |
| `issued_at` | `timestamptz` | NOT NULL, default `now()` |
| `expires_at` | `timestamptz` | NOT NULL |
| `revoked_at` | `timestamptz` | NULL — set on rotation or explicit logout |
| `replaced_by` | `uuid` | FK → `refresh_token.id` — chains rotations for token-family detection |

Drizzle relations: `refresh_token.user` → one `user`; `refresh_token.replacement` → one `refresh_token` (self).

## Invariants

- **Soft delete is universal on `user`** (`deleted_at IS NULL` filter in `repo.findUserByEmail`). New tables that represent first-class domain entities should follow the same pattern when they land.
- **Refresh-token family tracking**: rotation links the old row to its replacement via `replaced_by`. A reuse of an already-revoked token reveals a compromised family — see `auth.token-family.test.ts` for the policy in code.
- **No plaintext secrets at rest**: `password_hash` is argon2id; `refresh_token.hash` is a content hash of the cookie value. The plaintext refresh token only ever lives in the `refresh` cookie.
- **Forward-only migrations** for PoC scope; no rollback path. Migrate-then-seed is the boot order (`docker-compose.yml`).

## Migration history

| idx | tag | created |
|---:|---|---|
| 0 | `0000_initial` | 2025-05-16 (unix ms `1747353600000`) |

## Out of scope (planned, not on disk)

The following entities are described in `docs/APPLICATION.md` and `docs/ARCHITECTURE.md` but **have no schema yet**: `doctor_profile`, `patient_profile`, `specialization`, `slot`, `appointment`, `medical_record`, `medical_document`, `appointment_document`. Re-run `intel-refresh` once they land to repopulate this section.
