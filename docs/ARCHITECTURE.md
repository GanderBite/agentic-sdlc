# ARCHITECTURE — MedBridge

> Owns the **overarching structural shape** of MedBridge: the single system style, the module layout the codebase will use, and the cross-cutting policies every feature inherits by default. Per-feature internal patterns (layered vs transactional-script vs hexagonal) are decided downstream by `planning` against the latitude defined in §7.
>
> Grounded in `docs/APPLICATION_BRIEF.md` (the single source of truth produced by the brief step) and the `docs/INTEL.md` snapshot at `4ea7d103c254263c4eef97562c0d4b87f62edf17`. Repo is fresh: no `apps/`, `packages/`, or `src/` exist yet — this document defines the layout the scaffold step will materialise.

---

## 1. System overview

MedBridge is delivered as a **modular monolith**: one Hono HTTP server (`apps/api`) packaged with one React SPA (`apps/ui`), backed by one Postgres database and one local filesystem upload directory, all orchestrated by `docker compose`. The API is internally split into well-named modules (auth, accounts, medical-record, scheduling, appointments) that share a single process, a single Drizzle schema, and a single transaction scope. There are no internal services, no message bus, no queue — every UC-1..UC-5 path is a synchronous HTTP request that resolves against Postgres and (for documents) the bind-mounted `uploads/` volume.

This is the smallest architecture that meets the brief: a single-clinic, single-host, single-TZ PoC with seeded users, no notifications, no payments, no external integrations, no cancel/reschedule, no real PHI. Decomposition into services or functions would add deployment surface and cross-process consistency problems with **zero** payoff against §11 ("Scale: single-instance" / "Latency: PoC-grade") or §10 ("No third-party integrations").

```
                ┌─────────────────────────────────────────────────┐
                │                  Browser (SPA)                  │
                │  React + Vite + TanStack Router/Query + Shadcn  │
                └───────────────┬─────────────────────────────────┘
                                │  HTTPS, JSON over HTTP
                                │  Cookie: session (JWT, HttpOnly)
                                │  Cookie + header: CSRF (double-submit)
                                ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                     apps/api  (Hono, Node 25)                 │
        │                                                               │
        │   ┌── middleware chain ─────────────────────────────────────┐ │
        │   │ requestId → logger → cors → csrf → authn → authz       │ │
        │   └────────────────────────────────────────────────────────┘ │
        │                                                               │
        │   modules/                                                    │
        │     auth          accounts          medical-record            │
        │     scheduling    appointments      (shared)                  │
        │                                                               │
        │   shared/ db client (Drizzle) · errors · logger · time · ids  │
        └───────────────┬──────────────────────────────┬───────────────┘
                        │ SQL (Drizzle, single pool)   │ fs read/write
                        ▼                              ▼
                 ┌────────────┐                ┌──────────────────┐
                 │ Postgres   │                │ uploads/ (bind-  │
                 │ (volume)   │                │  mounted volume) │
                 └────────────┘                └──────────────────┘

         docker compose: ui · api · postgres · api-migrate (one-shot) · seed (one-shot)
```

The UI consumes the API through a **hand-written typed client** (per brief §6, "API style"), with request/response Zod schemas shared via `packages/contracts` (see §2). There is no tRPC, no Hono RPC client, no OpenAPI generator.

---

## 2. Module layout

### 2.1 Workspace topology (pnpm workspaces)

```
/
├── apps/
│   ├── api/                 Hono server, all backend modules
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── auth/
│   │       │   ├── accounts/
│   │       │   ├── medical-record/
│   │       │   ├── scheduling/
│   │       │   └── appointments/
│   │       ├── shared/      db client, errors, logger, time, ids, http helpers
│   │       ├── middleware/  requestId, csrf, authn, authz, errorHandler
│   │       ├── db/          drizzle config, schema barrel, migrations/
│   │       ├── seed/        one-shot seeder for specializations, users, slots, documents
│   │       └── main.ts      Hono app composition, route registration, server bootstrap
│   └── ui/                  React SPA
│       └── src/
│           ├── routes/      TanStack Router route tree
│           ├── features/    one folder per user-facing flow (login, schedule, profile, …)
│           ├── components/  Shadcn primitives + app-level components
│           ├── api/         hand-written typed client; one file per backend module
│           └── lib/         auth state, csrf token bootstrap, formatters, a11y helpers
└── packages/
    └── contracts/           Zod schemas + inferred TS types shared by api and ui
```

`packages/contracts` is the **only** code shared between `apps/api` and `apps/ui`. It exports one Zod schema per RPC operation (request and response shapes) plus the inferred TS types. Both apps import from it; neither app imports the other.

### 2.2 What becomes a module

A folder under `apps/api/src/modules/<name>` is a module **iff** it owns a bounded slice of the domain — its own tables in the schema, its own RPC routes, and its own service-layer rules. The five modules and their ownership:

| Module | Owns (tables) | Owns (RPC namespaces) | Rationale |
|---|---|---|---|
| `auth` | `refresh_token` | `auth.login`, `auth.logout`, `auth.refresh`, `auth.me` | Brief §7: JWT + refresh rotation + CSRF + argon2. Credentials (`password_hash`) live on `user` (owned by `accounts`) and are read by auth via the accounts public surface; CSRF is stateless double-submit (no `csrf_token` table). |
| `accounts` | `user` (incl. `email`, `role`, `password_hash`), `patient_profile`, `doctor_profile`, `specialization`, `doctor_specialization` | `patients.*`, `doctors.*`, `specializations.list` | All identity + profile + the seeded reference list. `password_hash` is a column on `user` rather than a separate credential table. Doctor↔specialization M2M lives here because it is profile data. |
| `medical-record` | `medication`, `condition`, `allergy`, `medical_document` | `medications.*`, `conditions.*`, `allergies.*`, `documents.*` (incl. upload + download) | Brief §9 patient-owned records. Per-field share decisions stay inside this module. |
| `scheduling` | `slot` | `slots.list`, `slots.create`, `slots.delete`, `slots.availability` | Doctor slot CRUD plus the availability query consumed by UC-1. Owns the slot-availability algorithm. |
| `appointments` | `appointment`, `appointment_summary`, `appointment_document_share` | `appointments.book`, `appointments.complete`, `appointments.get`, `appointments.listForPatient`, `appointments.listForDoctor` | The booking transaction (slot reservation + document-share rows) and the completion summary. Cross-module reads via `scheduling` and `medical-record` are mediated through public service APIs (see §6). |

Other concerns are explicitly **not** modules: logging, error handling, request-id, time, ids, db client live in `shared/`; HTTP cross-cutting (csrf, authn, authz) lives in `middleware/`. The seed is `apps/api/src/seed/`, not a module — it imports every module's repo layer to populate fixtures and runs as a one-shot container.

### 2.3 Layering rule (per module)

Each module is a small stack of files:

```
modules/<name>/
  routes.ts      Hono routes, RBAC tags, Zod parse, calls service
  service.ts     Use cases. Pure business rules. May call repo + other modules' service.
  repo.ts        Drizzle queries. The only file in the module that touches the db client.
  schema.ts      Drizzle table definitions for the tables this module owns.
  dto.ts         (optional) Re-exports / extensions of contracts/ schemas, mapping helpers.
  index.ts       Public surface: exports service functions other modules may call. Nothing else.
```

**Import rules (mechanically enforceable via eslint-plugin-boundaries or equivalent):**

- `routes.ts` MAY import `service.ts`, `dto.ts`, `shared/`, `middleware/`, `contracts/`.
- `service.ts` MAY import `repo.ts`, `shared/`, other modules' `index.ts` (their public surface) — never another module's `repo.ts`, `routes.ts`, or `schema.ts`.
- `repo.ts` MAY import `schema.ts`, `shared/db`. Never imports another module, never imports `service.ts`.
- `schema.ts` MAY import from `db/types` and other modules' `schema.ts` for FK references. It is the one exception to module-isolation, by necessity (Drizzle relations cross tables).
- Nothing under `apps/api/src/` MAY import from `apps/ui/`. Period.

---

## 3. Data flow

### 3.1 Booking an appointment (UC-1, the canonical write path)

1. **Browser** issues `POST /api/appointments.book` with cookies (session JWT + CSRF cookie) and `X-CSRF-Token` header. Body: `{ slotId, sharedDocumentIds: string[] }`.
2. **`middleware/requestId`** assigns a uuid; **`logger`** opens a request-scoped child logger; **`csrf`** validates double-submit; **`authn`** verifies the JWT and attaches `ctx.user`; **`authz`** asserts `role === 'patient'`.
3. **`appointments/routes.ts`** parses the body via `contracts.bookAppointmentRequest`. On failure → 422 with field errors.
4. **`appointments/service.book`** opens a single Drizzle transaction and:
   - calls `scheduling.service.reserveSlot(slotId, tx)` — verifies the slot is in the future, unbooked, not soft-deleted, and reserves it (sets `booked_appointment_id` after the appointment is inserted, or flips a `booked` flag — see §8).
   - calls `medical-record.service.assertDocumentsOwnedBy(patientId, sharedDocumentIds, tx)` — verifies every document belongs to this patient and is not soft-deleted.
   - inserts the `appointment` row with `specialization_id` denormalised from the slot's doctor's matching specialization (or from the request — see §8).
   - inserts one `appointment_document_share` row per shared document. Presence of a row is the sole authorization signal per brief §6.
5. The transaction commits. The route serialises the response via `contracts.bookAppointmentResponse` and returns 201.
6. **`errorHandler` middleware** catches any thrown `AppError` (see §5) and maps to the matching HTTP status + JSON body.

Every write follows the same shape: middleware → route (parse) → service (transaction + cross-module calls via public surface) → repo (Drizzle) → response. There is no event bus, no background job, no retry queue — the request returns when the database has durably accepted the change.

### 3.2 Document upload (the one non-DB write path)

`POST /api/documents.upload` accepts `multipart/form-data` through Hono's body parser; `medical-record/service.uploadDocument` validates MIME (`image/jpeg | image/png | application/pdf`) and size (≤ 10 MB) in-memory, generates a UUID filename, writes the bytes to `${UPLOAD_DIR}/<uuid>.<ext>` via `node:fs/promises`, then inserts the `medical_document` row in the **same DB transaction**. If the row insert fails, the file is `fs.unlink`-ed; if the fs write fails before insert, no row exists. Download is a streamed `GET /api/documents.download?id=…` that re-checks authorization (owner or active `appointment_document_share`) before opening the file handle.

### 3.3 Read path

Reads (`appointments.listForPatient`, `slots.availability`, etc.) follow routes → service → repo with no transaction. Soft-delete filtering (`WHERE deleted_at IS NULL`) is applied **inside `repo.ts`** by default; service-layer code that needs to see soft-deleted rows (only the audit/history reads — see §5) must call a `*IncludingDeleted` variant on the repo, making the intent explicit at the call site.

---

## 4. Persistence

### 4.1 Datastore

- **Primary datastore: PostgreSQL** (per intel "Planned Tech Stack" and brief §13). One database per deployment, one connection pool per `apps/api` process. No read replicas, no sharding.
- **Document blobs: local filesystem**, bind-mounted into the `api` container at `${UPLOAD_DIR}` (default `/var/lib/medbridge/uploads`). The blob is referenced by `medical_document.stored_filename` (UUID). This is explicitly chosen over Postgres `bytea` / S3 to keep PoC deployment one host and one volume.

### 4.2 Schema location

The single source of truth for the schema is the union of `apps/api/src/modules/*/schema.ts` files, re-exported through `apps/api/src/db/schema.ts` (the Drizzle barrel that Drizzle Kit reads). Tables are namespaced by their module — there is no `apps/api/src/db/tables.ts` god-file. The barrel exists only so Drizzle Kit can introspect everything in one import.

### 4.3 Migrations

- **Tool: Drizzle Kit** (`drizzle-kit generate`, `drizzle-kit migrate`).
- **Location:** `apps/api/src/db/migrations/` (committed SQL files).
- **Application:** a one-shot `api-migrate` container in `docker compose` runs `drizzle-kit migrate` before the `api` and `seed` services start. The `api` service does **not** auto-migrate on boot — that would race when scaled (even though we won't scale, the no-auto-migrate-in-server rule prevents foot-guns when a second pod is ever introduced).
- **Seed:** `apps/api/src/seed/main.ts` runs as a separate one-shot container after `api-migrate` succeeds. It is idempotent (no-op if the `specialization` table already has rows) so `docker compose up` is safe to re-run.

### 4.4 Schema-level conventions

- Every table has `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`.
- Every table that participates in the domain (everything except `refresh_token` and join tables that are pure many-to-many) has `deleted_at timestamptz null`. Soft-delete only — see §5.1.
- All timestamps are `timestamptz`. The application's local time matches `TZ` (brief §6, default `Europe/Warsaw`); the DB stores UTC under the hood; the API renders ISO-8601 with the configured offset for the UI.
- Foreign keys have **no `ON DELETE CASCADE`** (brief §9: "foreign-key cascades are *not* used for deletes"). They are `ON DELETE RESTRICT`, which combined with soft-delete-only semantics means a delete never propagates.

---

## 5. Cross-cutting policies

### 5.1 Deletion / soft-delete

- Every write that "deletes" a row sets `deleted_at = now()`. Hard `DELETE` is forbidden in application code; the only hard deletes are administrative SQL during seeding.
- Repo-layer query builders default to `WHERE deleted_at IS NULL`. A `*IncludingDeleted` variant exists only for endpoints that intentionally surface history (e.g. the patient's completed-appointments list must still show appointments whose `slot` was soft-deleted after the visit).
- Soft-deleted rows are **read-only**: services must refuse to mutate a row with non-null `deleted_at` (e.g. you cannot re-book a soft-deleted slot, even if it is technically still in the DB).
- Brief §7 demands "historical appointment traces remain intact" — therefore `appointment`, `appointment_summary`, and `appointment_document_share` are append-only after creation. No `UPDATE` of summary fields after `appointments.complete` returns; no soft-delete of completed appointments from the application UI.

### 5.2 Error handling

- Services throw subclasses of `AppError` from `shared/errors.ts`:
  - `ValidationError` (422) — input shape problems Zod did not catch (e.g. business-rule violations like "slot is in the past").
  - `NotFoundError` (404).
  - `UnauthorizedError` (401) — no/invalid credentials.
  - `ForbiddenError` (403) — RBAC or document-share denial.
  - `ConflictError` (409) — e.g. slot already booked, double-submit.
  - `UnsupportedMediaError` (415) — upload MIME mismatch.
  - `PayloadTooLargeError` (413) — upload > 10 MB.
- A single `errorHandler` middleware maps `AppError` → JSON `{ error: { code, message, details? } }`. Anything that is not an `AppError` is logged with `level=error` and rendered as 500 with no internal details leaked.
- Zod parse failures inside `routes.ts` are rethrown as `ValidationError` with the issues array as `details`.
- The UI's typed client treats any non-2xx as a typed `ApiError` and renders the `error.code` for known cases.

### 5.3 Logging

- Structured JSON to stdout (brief §13). One log line per request emitted by the `logger` middleware: `{ requestId, method, path, status, durationMs, userId? }`.
- Request-scoped child logger is attached to `ctx.log` so service-layer code can emit additional lines with the request id auto-included.
- **Never log:** passwords, tokens (JWT or refresh), CSRF token values, document file contents, full request bodies. Body field whitelist is opt-in per-route if richer logging is needed.
- Log level via `LOG_LEVEL` env (`debug | info | warn | error`), default `info` in production-like, `debug` in `docker compose` dev.

### 5.4 Auth model

- **Identity:** every authenticated request carries a short-lived JWT (`SESSION_TTL = 15 min`) in an HttpOnly + Secure + SameSite=Lax cookie; refresh is a long-lived rotating refresh token in a second HttpOnly + Secure cookie (`REFRESH_TTL = 7 days`), stored server-side in `refresh_token` keyed by hash and revoked on use (rotation).
- **CSRF:** double-submit cookie — a non-HttpOnly `csrf_token` cookie is read by the SPA and echoed in the `X-CSRF-Token` header on every state-changing request (`POST`, `PATCH`, `DELETE`). The middleware compares the cookie value with the header value with a constant-time check.
- **Passwords:** argon2id (parameters tuned in `tech-stack`), never logged, never returned in any response.
- **RBAC:** the `authz` middleware reads `role` from the JWT claims. Routes declare their required role(s) via a small `requireRole('patient' | 'doctor')` wrapper. Resource-level checks (e.g. "the patient owns this document", "the doctor owns this slot") live in `service.ts`, not in middleware — they are domain rules, not transport rules.
- **The document-share rule** (the brief's most security-sensitive line): a doctor may read a `medical_document` iff a non-soft-deleted `appointment_document_share` row links it to a non-soft-deleted `appointment` whose `doctor_id` matches the requesting user. Implementation lives in `medical-record/service.assertCanDoctorReadDocument`. It is exercised by a dedicated unit test (brief §5).
- **Defaults from §12 OPEN item:** doctors see only **explicitly shared documents** at appointment time; medications, conditions, and allergies remain private. Architecture adopts this default unchanged.

---

## 6. Boundaries

### 6.1 Public vs private API (HTTP)

- The only public HTTP surface is `apps/api`'s `/api/*` RPC routes (per brief §6, e.g. `POST /api/appointments.book`). Every route name is `<resource>.<verb>` with the resource matching one of the module's RPC namespaces in §2.2.
- Static assets (`apps/ui`'s built bundle, served by an nginx container or by Vite in dev) are mounted at `/`. There is no SSR; the SPA boots in the browser and hits `/api`.
- `/api/health` returns `{ ok: true }` and is the only un-authenticated route besides `auth.login` and `auth.refresh`.
- Document download (`GET /api/documents.download?id=…`) is the one non-JSON response — it streams the file with the original filename in `Content-Disposition`. Still RPC-style naming, still authorization-checked.

### 6.2 Public vs private API (cross-module, in-process)

- A module's `index.ts` is its **public surface**. It re-exports service functions and types that other modules are allowed to call.
- Other modules' code MAY only import from `<other-module>/index.ts`. The eslint boundaries rule enforces this.
- A module's `repo.ts`, `routes.ts`, `schema.ts`, internal helpers are **private**. If `appointments` needs a slot-level operation, it calls `scheduling.reserveSlot`, not `scheduling/repo.ts`.
- Tables are private to their owning module (§2.2 lists ownership). A cross-module join MUST go through the owning module's service — or, when read-only and performance-critical, via a deliberate exception documented in `.planning/intel/conventions.md` after `intel-refresh` is rerun on real code.

### 6.3 Internal vs external dependencies

- **External deps allowed at runtime:** `hono`, `drizzle-orm`, `pg`, `zod` (v4), `argon2`, `jsonwebtoken` (or `jose` — tech-stack decides), `pino` (or equivalent JSON logger — tech-stack decides). Nothing else without an explicit ADR entry.
- **Banned at runtime:** any ORM other than Drizzle; any HTTP framework other than Hono; any auth-as-a-service SDK; any cloud SDK (no AWS/GCP/Azure in the PoC).
- **UI runtime deps** are pinned by `tech-stack` (`react`, `vite`, `@tanstack/router`, `@tanstack/query`, `tailwindcss@^4`, `@radix-ui/*` via Shadcn). The UI MUST NOT depend on `apps/api`; it depends on `packages/contracts` only.
- **Dev deps** (test runner, lint, formatter) are picked by `tech-stack`. Architecture takes no position beyond requiring that the test runner can execute both unit and integration tests for `apps/api` (brief §7).

---

## 7. Per-feature architectural latitude

Downstream `planning` decides the internal pattern for each feature. The system defaults are:

- **Default internal pattern:** the layered shape from §2.3 (`routes.ts` → `service.ts` → `repo.ts` → `schema.ts`). The vast majority of features in the brief (medical record CRUD, doctor profile, slot CRUD, appointment listing, login) fit this shape with no further structuring.
- **Inherit-vs-derive rule for `planning`:** if a feature is a thin CRUD over one or two tables of one module, **inherit** the default and do not produce a `.planning/features/ARCHITECTURE-<slug>.md`. Produce one only when the feature warrants deviation, and explain the deviation against the latitude below.

**Valid feature-level styles for this system:**

| Style | When `planning` MAY pick it | Examples likely to use it |
|---|---|---|
| **Layered (default)** | The feature owns 1–N tables and a handful of write/read operations with linear flow. | Patient medical-record CRUD; doctor profile edit; slot CRUD; appointment listing; login. |
| **Transactional script** | The feature is a single end-to-end use case with a non-trivial transaction crossing modules. The "service" collapses to one orchestrating function. | `appointments.book` (slot reservation + document-share insertion in one tx). `appointments.complete` (insert summary, mark state). |
| **Query-first (CQRS-lite, read-only)** | The feature is a dashboard / availability query that joins across modules and needs a purpose-built read model with no writes. | `slots.availability` (UC-1 slot grid); the patient dashboard's combined "upcoming + completed" view; the doctor's "today's free slots". The read query MAY live in a `query.ts` file inside the owning module (an additional, optional layer alongside `repo.ts`). |

**Explicitly out of scope for v1 (planning MUST NOT pick these without an architecture extension):**

- **Hexagonal / ports-and-adapters** — there are no external adapters to swap (no email provider, no payment processor, no calendar API — brief §10). The indirection would be ceremony.
- **Event sourcing / event-driven** — the brief is explicitly synchronous: no notifications, no queue, no background jobs (brief §13: "no metrics / tracing stack"). Appointment + summary are append-only by data convention, not by event log.
- **Vertical slicing across modules** (one folder per use case at top level) — the §2.2 module split already enforces vertical cohesion at the right granularity. Re-slicing per use case would scatter the schema and break the import rules.
- **Per-feature DB or per-feature schema** — single DB, single schema. Modules namespace by table prefix, not by `SCHEMA`.

`planning` writes a per-feature `.planning/features/ARCHITECTURE-<slug>.md` **only when** it picks Transactional script or Query-first, **or** when a feature genuinely spans more than one module's public surface and the orchestration deserves a named home. A feature that lives entirely inside one module under the default layered shape gets a PRD only; no separate architecture file.

---

## 8. Open structural questions

Deferred to a future architecture extension (none block the current scaffolding step):

1. **Slot "booked" state representation** — boolean column on `slot` vs nullable `booked_appointment_id` FK back from `slot` to `appointment`. The §3.1 transaction works with either; the trade-off is between query simplicity (boolean) and referential integrity (FK). To be decided when the `scheduling` module is planned.
2. **`appointment.specialization_id` denormalisation source** — copied from the patient's choice at booking time vs derived from the doctor's `doctor_specialization` rows at booking time and frozen. Affects auditability if a doctor later drops a specialization.
3. **Refresh-token storage** — server-side row (`refresh_token` table) keyed by hash, vs stateless rotation with a revocation list. The `tech-stack` step picks the JWT library; that choice may force the answer.
4. **CSRF token issuance** — pure double-submit (random cookie value, no server state) vs server-issued token bound to session. Brief mandates double-submit; the precise generation strategy is left to `tech-stack`.
5. **`packages/contracts` shape** — flat per-module files (`auth.ts`, `appointments.ts`, …) vs one file per RPC operation. Decided when the first feature lands.
6. **Doctor visibility into patient medications / conditions / allergies at appointment time** — the brief §12 `OPEN:` item. Architecture adopts the default (only explicitly shared documents are visible; record fields stay private), but a future revision MAY add `appointment_medication_share` / `appointment_condition_share` / `appointment_allergy_share` join tables mirroring `appointment_document_share`. The `medical-record` module is the home for that extension if and when it arrives.
7. **Integration-test database strategy** — ephemeral Postgres per test file via testcontainers, vs a single shared schema with per-test transaction rollback. Affects test layout and is owned by `tech-stack`, but the architecture's "no auto-migrate in server" stance constrains the answer.
