# APPLICATION_BRIEF — MedBridge

> Synthesised from `docs/APPLICATION.md`, the intel handoff at `docs/INTEL.md`, and the human's answers to the brain-storming questions. This brief is the single source of truth that downstream `architecture`, `tech-stack`, and `prd` steps must consume. Features are sketched here; deep feature design lives in `.planning/features/FEATURE-*.md` produced by later sprints.

## 1. Product summary

**MedBridge** is a proof-of-concept web application for booking medical appointments. Patients pick a specialization, optionally narrow to a specific doctor, and select an available time slot. Doctors configure their availability and write structured summaries of the appointments they conduct. The PoC scope deliberately omits sign-up, cancellation, reschedule, and notifications — it focuses on the booking and post-visit summary loop end-to-end with seeded users.

## 2. Target users

- **Patient** — an authenticated end-user who maintains a personal medical record (medications, known diseases/conditions, allergies, uploaded documents) and books appointments with doctors. Patients control which of their documents are exposed to a specific doctor on a per-appointment basis.
- **Doctor** — an authenticated clinician who configures bookable slots, sees the patient's shared context at the time of the appointment, conducts the visit (out-of-band; MedBridge does not deliver the consultation itself), and records a structured outcome.

Both roles are seeded into the database; no self-service registration in the PoC.

## 3. Core problem

The PoC demonstrates a minimum credible workflow for the patient → doctor scheduling handoff:

1. A patient with a curated medical record can be matched to a relevant specialist and book a time slot in a few clicks.
2. The doctor receives only the medical context the patient explicitly chose to share for that appointment, never the patient's full record by default.
3. The doctor closes the loop by recording a structured outcome (diagnosis, notes, prescription) that becomes part of the patient's appointment history.

## 4. Primary use cases

### UC-1 Patient books an appointment
Patient logs in → Dashboard shows upcoming and completed appointments → opens "Schedule appointment" → picks a specialization (from a seeded enumerated list) → optionally narrows to a named doctor of that specialization → sees the union of available `30-minute` slots (all doctors of that specialization, or just the chosen doctor) → selects a slot → picks zero-or-more medical documents from their record to share with the doctor for this appointment → confirms the summary → appointment is created and final.

### UC-2 Patient curates their medical record
Patient can add/update/remove (soft-delete) entries in: current medications, known diseases / conditions, allergies, and medical documents (JPEG / PNG / PDF, ≤ 10 MB each, original filename preserved, on-disk filename is a generated UUID). These entries are the pool from which the patient picks what to share at booking time.

### UC-3 Doctor configures slots
Doctor logs in → Dashboard shows today's free slots and incoming appointments → manages availability by creating bookable slots of the fixed `30-minute` duration. Slots are owned by the doctor; only unbooked future slots can be removed (soft-deleted).

### UC-4 Doctor conducts and summarises an appointment
At or after the appointment's scheduled start, the doctor opens the appointment → sees patient identity, the medical documents the patient shared (visible from the moment of booking, see §6), and the patient's selected current medications / conditions / allergies that the patient included → fills in a structured **diagnosis + notes + prescription** form → marks the appointment complete. The completed record then appears in the patient's "completed appointments" dashboard view.

### UC-5 Doctor maintains profile
Doctor edits their own name, contact info, and the subset of seeded specializations they hold (a doctor may hold more than one — see §6).

## 5. Success metrics (PoC)

This is a developer-facing PoC, not a launched product, so metrics are qualitative milestones rather than KPIs:

- A seeded patient and seeded doctor can complete UC-1 through UC-4 end-to-end with no manual database touch outside seeding.
- All four use cases are covered by API integration tests; the unit-test suite covers slot-availability logic and the document-share authorization rule.
- `docker compose up` from a fresh checkout brings up the UI, API, and database with seed data ready.
- WCAG 2 AAA compliance for the implemented views (Login, Dashboard, Doctor profile, Patient profile, Schedule Appointment form, Appointment details) is verified by manual a11y review against the WCAG 2.2 AAA success criteria.

## 6. Decisions resolved by brain-storming round 1

| Topic | Decision |
|---|---|
| **Slot duration** | Fixed **30 minutes** for the PoC. All doctor-configured slots are 30 min; no per-doctor override. |
| **Specializations source** | **Seeded table, immutable in the PoC.** A `specialization` table is populated at seed time (e.g. cardiologist, dermatologist, …) and the application offers no admin UI to mutate it. Doctors and the scheduling form both reference rows from this table. |
| **Doctor multi-specialization** | **Yes** — a doctor may hold more than one specialization simultaneously. Model as a many-to-many `doctor_specialization` join table. The scheduling form treats a doctor as available for a specialization if any of their specialization rows match the patient's choice. |
| **Document-share visibility** | The doctor can view the patient's shared documents **immediately on booking**, not only at appointment start and not deferred until completion. This is the simplest authorization rule and matches the PoC's "no cancel/reschedule" trade-off. |
| **Appointment summary shape** | **Structured: diagnosis, notes, prescription** (three fields). All three are persisted as separate columns / fields; prescription is optional, diagnosis and notes are required to mark complete. |
| **Timezone handling** | **Single server timezone, local time** — the server runs in one timezone (configured via env, e.g. `TZ=Europe/Warsaw`) and all timestamps are stored and rendered relative to that one zone. No per-user timezone, no UTC conversion gymnastics. The architecture step should document the chosen TZ as part of the deployment shape. |
| **API style** | **RPC-style JSON over HTTP** — Hono routes named after operations (e.g. `POST /api/appointments.book`) returning JSON. Not REST resource semantics, not tRPC/Hono-RPC typed client. Request and response shapes validated with Zod v4 on both sides; the UI consumes them through a hand-written typed client. |

No question was left blank, so there are no `OPEN:` items from the question set.

## 7. Scope — in

- JWT auth with refresh-token rotation; argon2 password hashing; CSRF double-submit cookie; http-only + secure session cookies.
- Two seeded roles (Doctor, Patient) with RBAC enforced server-side on every operation.
- Patient medical record CRUD: medications, conditions, allergies, document upload (JPEG / PNG / PDF, ≤ 10 MB, UUID on-disk filename, original filename preserved in DB).
- Doctor profile management (name, contact info, specializations from seeded list).
- Doctor slot management (create / soft-delete 30-min slots).
- Appointment booking flow per UC-1, including per-appointment document share selection.
- Doctor appointment view + structured summary capture (diagnosis / notes / prescription).
- Dashboards: upcoming appointments (both roles), today's free slots (doctor), completed appointments (patient).
- Soft-delete semantics across every entity (`deleted_at` nullable timestamp) so historical appointment traces remain intact.
- API integration + unit tests on `apps/api`.
- WCAG 2 AAA target on `apps/ui`.
- `docker compose` local deployment of UI + API + Postgres.

## 8. Scope — out (frozen by the seed)

- No self-service sign-up; users are seeded.
- No appointment cancellation or rescheduling once booked.
- No in-app or email/SMS notifications.
- No UI unit, component, or end-to-end tests.
- No admin UI for specializations, users, or any other data — DB seeds only.
- No real PHI / patient data; seed fixtures are synthetic.
- No payments, insurance, or billing.
- No video / messaging — the consultation itself happens out-of-band.
- No multi-tenant or organisation model; one MedBridge deployment is one clinic.

## 9. Data the system holds

Conceptual entities (drizzle schema and exact column lists are owned by the `architecture` / `tech-stack` step):

- **User** — common fields (id, email, password hash, role, created_at, deleted_at). Discriminated by `role ∈ {doctor, patient}` either as a column with role-specific profile tables, or single-table inheritance. The architecture step picks the shape.
- **Specialization** — seeded, immutable in PoC (id, name, slug).
- **DoctorProfile** — name, contact info, FK to user.
- **DoctorSpecialization** — many-to-many join (doctor_id, specialization_id).
- **PatientProfile** — name, contact info, FK to user.
- **Slot** — doctor_id, starts_at, duration (constant 30 min in PoC but stored for forward-compat), booked flag (or nullable appointment_id), deleted_at.
- **Appointment** — patient_id, doctor_id, slot_id, specialization_id (denormalised: the specialization the patient chose), state ∈ {scheduled, completed}, created_at, completed_at, deleted_at.
- **AppointmentSummary** — appointment_id (1:1), diagnosis (text, required), notes (text, required), prescription (text, optional), created_at.
- **Medication / Condition / Allergy** — patient-owned records (patient_id, name, optional fields like dose / since / severity, deleted_at).
- **MedicalDocument** — patient_id, original_filename, stored_filename (UUID), mime_type, size_bytes, uploaded_at, deleted_at.
- **AppointmentDocumentShare** — many-to-many join between appointment and medical_document, created at booking time. Presence of a row grants the doctor read access to the document from the moment the appointment is created.

All deletes are soft (`deleted_at` set). Joins must filter out soft-deleted rows by default; foreign-key cascades are *not* used for deletes.

## 10. Third-party integrations

None in the PoC. No payment processor, no calendar provider, no email/SMS gateway, no identity provider, no telemetry vendor. Everything required runs inside `docker compose`.

## 11. Non-functional constraints

- **Latency:** PoC-grade. No formal SLO; pages should feel snappy on a developer laptop. The architecture step is free to set internal targets (e.g. p95 < 300 ms for read endpoints on a seeded DB) but is not bound by an external SLA.
- **Scale:** Single-instance. Seed data is small (tens of doctors, dozens of patients, hundreds of slots). No need to design for horizontal scaling, partitioning, or read replicas.
- **Compliance:** No real PHI, so HIPAA / GDPR Article 9 obligations do **not** apply to this PoC. Treat the security controls listed in §7 as the floor for credible handling, not as compliance certification. `OPEN:` if a future revision intends to handle real patient data, a separate compliance pass is required before launch.
- **Security floor:** argon2id password hashing, refresh-token rotation, CSRF double-submit, http-only + secure cookies, RBAC enforced at the route layer, upload MIME-type + size validation, generated on-disk filenames to prevent path-traversal and overwrite.
- **Accessibility:** WCAG 2 AAA on every shipped view (Login, Dashboard, Doctor profile, Patient profile, Schedule Appointment form, Appointment details). Forms must be fully keyboard-navigable and screen-reader-labelled.
- **Auditability:** Soft deletes preserve history. Appointments, summaries, and document shares are append-only after creation in the PoC (no edit-after-complete flow).
- **Timezone:** Single server timezone configured at deploy time (e.g. `TZ=Europe/Warsaw`). All slot times stored and rendered in that one zone. Document the chosen TZ in the deployment artefact.

## 12. UI surface

A React + Vite + Tailwind v4 + Shadcn UI single-page app routed by TanStack Router and fetching through TanStack Query against the RPC-style JSON API.

Views in scope:

- **Login** — email + password, error states, CSRF-aware.
- **Dashboard** — role-aware:
  - Patient: upcoming appointments, completed appointments, CTA to "Schedule appointment".
  - Doctor: upcoming appointments, today's remaining free slots, CTA to manage slots.
- **Patient profile** — view + edit name, contact info, medications, conditions, allergies, documents (upload / soft-delete).
- **Doctor profile** — view + edit name, contact info, specializations (multi-select from seeded list), and bookable slot management.
- **Schedule Appointment form** — multi-step: specialization → optional doctor → slot grid → document share selection → confirmation → submit.
- **Appointment details** — role-aware view:
  - Patient: own appointment, doctor name + specialization, shared documents (read-only), summary once completed.
  - Doctor: patient name, the documents the patient shared (immediately visible), the patient's selected medications/conditions/allergies (out-of-scope decision — see OPEN below), and the structured-summary form.

No mobile-specific layouts beyond responsive Tailwind defaults. No theming.

`OPEN:` whether the patient's medications / conditions / allergies are *also* visible to the doctor at appointment time, or whether the doctor only sees the explicitly shared **documents**. The seed and answers only fixed document-share visibility, not record-field visibility. Best-effort default for the architecture step: **only explicitly shared medical documents are visible to the doctor; medications / conditions / allergies remain private to the patient unless a future revision adds a per-field share.**

## 13. Deployment shape

- **Topology:** single host (developer laptop or single VM) running `docker compose`. Services: `ui` (Vite dev server or built static + nginx — architecture step decides), `api` (Hono on Node 25), `postgres` (Drizzle migrations applied at container start), and a one-shot `seed` job that populates specializations, doctors, patients, and a handful of slots / documents.
- **Persistence:** Postgres volume for DB; bind-mounted `uploads/` directory on the host for medical documents (matching the seed's `uploads/` requirement). Both must survive `docker compose down` and re-up.
- **Configuration:** environment variables for `DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`, `UPLOAD_DIR`, and `TZ`. No secret manager in PoC; `.env.example` documents the required vars.
- **Migrations:** Drizzle Kit, applied at container start by the `api` service or by an `api-migrate` one-shot. The seed runs after migrations.
- **Observability:** structured JSON logs from the API to stdout; no metrics / tracing stack in the PoC.

## 14. Handoff to the next step

- The **architecture** step owns: monorepo layout, Drizzle schema, RBAC enforcement strategy, RPC endpoint catalogue, slot-availability algorithm, document-share authorization implementation, and the docker-compose topology.
- The **tech-stack** step owns: concrete test runner (vitest vs node:test), lint / format choice, build pipeline, and pinning to specific minor versions of Hono, Drizzle, TanStack Router/Query, etc.
- The **prd** step owns: turning §4 use cases into discrete feature specs under `.planning/features/`.

Any decision a downstream step needs that isn't covered here is to be flagged back with `OPEN:` rather than guessed at silently — but every brain-storming question in this round was answered, so the only outstanding `OPEN:` is the doctor's visibility into medications / conditions / allergies fields noted in §12, with a stated default the architecture step may adopt unless the human overrides it.
