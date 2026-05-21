# Database schema

Snapshot: `1c1ea6393c49b62e98fdc61a77c743b222a459bc`.

> **Status: FRESH REPO.** Sprint-001 was reset (commit `1c1ea63`). No `apps/api/src/db/schema.ts`, no `drizzle.config.ts`, no `migrations/` on disk. There is nothing to derive a schema from.

## Result: n/a

No database schema currently exists in the repository. Drizzle is planned (per `docs/APPLICATION.md` / `docs/TECH_STACK.md`) but has not yet been scaffolded.

## Planned tooling (NOT yet on disk)

- **Database**: PostgreSQL (latest LTS — version pinned by `docker-compose.yml` once it lands again).
- **Driver**: `pg` (`Pool`), with Drizzle's `drizzle-orm/node-postgres` adapter.
- **ORM**: Drizzle ORM.
- **Migration tool**: Drizzle Kit, configured by `apps/api/drizzle.config.ts`.
- **Migration files**: `apps/api/src/db/migrations/*.sql` (statement-breakpointed), metadata in `apps/api/src/db/migrations/meta/`.
- **Schema source**: `apps/api/src/db/schema.ts` as a barrel that re-exports module-owned schema fragments (`modules/<feature>/schema.ts`).

## Planned invariants

- **Soft delete** on first-class domain entities via `deleted_at` (queries default to `WHERE deleted_at IS NULL`).
- **No plaintext secrets at rest**: passwords stored as argon2id digests; refresh-token rows store a content hash of the cookie value, never the plaintext token.
- **Forward-only migrations** for PoC scope; no rollback path. Migrate-then-seed is the planned boot order.
- **Refresh-token family tracking**: rotation links the old row to its replacement (e.g. `replaced_by`) so reuse of a revoked token reveals a compromised family.

## Planned entities (from `docs/APPLICATION.md` / `docs/ARCHITECTURE.md`)

The application brief calls for the following tables when the schema is scaffolded; none exist yet:

`user`, `doctor_profile`, `patient_profile`, `specialization`, `slot`, `appointment`, `medical_record`, `medical_document`, `appointment_document`, `refresh_token`.

## Re-derivation contract

Once `apps/api/src/db/schema.ts` and `apps/api/src/db/migrations/` exist again, `relay run intel-refresh` will replace this placeholder with the real table list, columns, constraints, relations, and migration history derived from the on-disk schema and SQL.
