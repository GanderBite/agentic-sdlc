# Database schema

> **Status:** no schema on disk. The repo has no `apps/api/`, no Drizzle setup, no migrations. This file seeds the planning view derived from `docs/APPLICATION.md`; once Drizzle is in place, `intel-refresh` will replace it with the real tables.

## Planned tooling

- Database: **PostgreSQL** (Docker Compose service).
- ORM: **Drizzle ORM**.
- Migration tool: **Drizzle Kit** (`drizzle-kit generate`, `drizzle-kit migrate` — exact commands populated by `tech-stack` step).
- Schema location (planned): `apps/api/src/db/schema/*.ts` with a barrel `apps/api/src/db/schema/index.ts`.
- Migration location (planned): `apps/api/drizzle/` (generated SQL + meta).

## Planned entities (from APPLICATION.md)

- `users` — base identity, `role` enum (`doctor` | `patient`), `password_hash` (argon2), `created_at`, `deleted_at` (soft delete).
- `doctor_profiles` — name, contact, specializations[], FK → `users.id`.
- `patient_profiles` — name, contact, FK → `users.id`.
- `specializations` — lookup (cardiologist, dermatologist, …).
- `slots` — `doctor_id`, `starts_at`, `ends_at`, status; doctor-configured.
- `appointments` — `slot_id`, `patient_id`, `status` (`scheduled` | `completed`), `summary` (doctor-authored), soft-deletable.
- `medical_records` — `patient_id`, free-form entries for medications, conditions, allergies (separate tables likely; refine in architecture step).
- `medical_documents` — `patient_id`, `original_filename`, `stored_filename` (uuid), `mime_type`, `size_bytes`, `uploaded_at`, soft-deletable. JPEG/PNG/PDF ≤10 MB.
- `appointment_documents` — join table sharing specific documents with an appointment.
- `refresh_tokens` — for JWT rotation; rotated on each use, revocable.

## Constraints / invariants

- **Soft delete everywhere**: all tables get `deleted_at TIMESTAMPTZ NULL`. Queries default to `WHERE deleted_at IS NULL`.
- **No real patient data** ever (test fixtures included).
- Stored document filenames are server-generated UUIDs; the original filename is preserved as a column for display only.
- Appointments are immutable once scheduled (no cancel/reschedule per PoC trade-offs).

## Migration policy (planned)

- Every schema change goes through Drizzle Kit generation; no hand-edited SQL except for raw fixtures.
- Migrations are forward-only in PoC scope; rollback is out of scope.

Replace this file with actual schema diffs once `apps/api/src/db/schema/` exists.
