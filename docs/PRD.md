# PRD — MedBridge

> Product Requirements Document for MedBridge, the proof-of-concept patient ↔ doctor scheduling app described in `docs/APPLICATION_BRIEF.md`. Scoped to the modular monolith laid out in `docs/ARCHITECTURE.md` (modules: `auth`, `accounts`, `medical-record`, `scheduling`, `appointments`) and implemented on the stack pinned in `docs/TECH_STACK.md` (Hono + React + Drizzle + Postgres, pnpm workspaces, Vitest + testcontainers, Biome, docker compose).
>
> This document is the source of truth for **what features ship, in what order, and what each one means**. Each acceptance bullet is observable so the planner can convert it into ≥1 verification gate. Feature-internal design (DB columns, RPC field shapes, edge-case enumeration) lives in `.planning/features/FEATURE-*.md` produced by later sprints.

---

## 1. Product summary

**MedBridge** is a single-clinic proof-of-concept web application that lets a seeded **patient** book a 30-minute appointment with a seeded **doctor** by picking a specialization, optionally narrowing to a named doctor, choosing an available slot, and selecting which of their uploaded medical documents to share for that visit. After the appointment's scheduled time, the doctor closes the loop by recording a structured **diagnosis / notes / prescription** summary that becomes part of the patient's completed-appointment history. The product deliberately omits sign-up, cancellation, rescheduling, and notifications so the booking-and-summary loop can be demonstrated end-to-end with the minimum credible surface area.

The user is a developer or stakeholder reviewing the PoC, embodied through two seeded roles: a **patient** who maintains a personal medical record (medications, conditions, allergies, uploaded JPEG/PNG/PDF documents) and a **doctor** who configures bookable slots and writes appointment summaries. The core problem MedBridge solves is the patient → doctor scheduling handoff with **per-appointment document sharing** as the authorization primitive: the doctor never sees the patient's full record by default, only what the patient explicitly attaches to a booking. The PoC ships as a `docker compose` stack (UI, API, Postgres, one-shot migrate, one-shot seed) running in a single configured server timezone, with WCAG 2 AAA targeted on every shipped view and the security floor (argon2id + JWT with refresh rotation + CSRF double-submit) enforced server-side.

---

## 2. Core features

### Feature 1 — Authenticated login & session management `p0`

**Module(s):** `auth`

**Description:** Seeded patients and doctors authenticate with email + password; the server issues a short-lived JWT session cookie and a rotating refresh token cookie, plus a CSRF double-submit cookie consumed by the SPA.

**User story:** As a seeded patient or doctor, I want to log in with my email and password so that I can access the app under my role with my session protected against forgery.

**Acceptance:**
- `POST /api/auth.login` with valid seeded credentials returns HTTP 200, sets HttpOnly+Secure `session` and `refresh_token` cookies, sets a non-HttpOnly `csrf_token` cookie, and returns `{ user: { id, email, role } }`.
- `POST /api/auth.login` with an unknown email or wrong password returns HTTP 401 with `{ error: { code: "UNAUTHORIZED" } }` and sets no cookies; failed attempts incur an argon2id verify regardless of email validity (constant-time path).
- `POST /api/auth.refresh` with a valid refresh cookie rotates the refresh token (old hash is revoked, new hash stored) and returns a fresh session JWT; replaying a revoked refresh token returns HTTP 401.
- `GET /api/auth.me` returns the current user when a valid session cookie is presented and HTTP 401 otherwise.
- `POST /api/auth.logout` clears both cookies and revokes the active refresh-token row server-side.
- Any state-changing route called without a matching `X-CSRF-Token` header value to the `csrf_token` cookie returns HTTP 403 with `{ error: { code: "FORBIDDEN" } }`.
- Passwords, JWTs, refresh tokens, and CSRF token values never appear in any log line emitted by the API (verified by a log-capture integration test).

---

### Feature 2 — Patient medical record CRUD `p0`

**Module(s):** `medical-record`

**Description:** Authenticated patients create, list, update, and soft-delete entries in three structured lists (medications, conditions, allergies) that form the pool from which they pick what to share at booking time.

**User story:** As a patient, I want to maintain my list of current medications, known conditions, and allergies so that I can attach relevant entries when I book an appointment.

**Acceptance:**
- `POST /api/medications.create` (and analogous `conditions.create`, `allergies.create`) with role `patient` persists a row scoped to the caller's `patient_id` and returns the created entity; called with role `doctor` returns HTTP 403.
- `POST /api/medications.list` (and analogous routes) returns only the caller's rows where `deleted_at IS NULL`, ordered most-recent-first.
- `POST /api/medications.update` rejects updates to a row whose `deleted_at` is non-null (HTTP 409 `CONFLICT`) and rejects updates to a row owned by a different patient (HTTP 403).
- `POST /api/medications.delete` sets `deleted_at = now()` on the targeted row; subsequent `medications.list` calls do not return it, but it remains in the database.
- Zod-rejected payloads return HTTP 422 with a `details` array enumerating each failing field.
- All three lists behave identically with respect to ownership, soft-delete, and validation (one shared integration-test parametrisation suffices).

---

### Feature 3 — Medical document upload, listing, and download `p0`

**Module(s):** `medical-record`

**Description:** Patients upload JPEG/PNG/PDF documents (≤ 10 MB) that are stored on disk with a UUID filename while preserving the original filename in the database; patients can list and download their own documents, and doctors can download a document only when an active appointment_document_share row links it to one of their appointments.

**User story:** As a patient, I want to upload and download my medical documents so that I can attach them to specific bookings, and as a doctor I want to download a document only if the patient has shared it with me for one of my appointments.

**Acceptance:**
- `POST /api/documents.upload` accepts `multipart/form-data`, validates `Content-Type ∈ { image/jpeg, image/png, application/pdf }` and size `≤ 10 MB`; on success the response includes the document's id and original filename, the file is written to `${UPLOAD_DIR}/<uuid>.<ext>`, and the DB row is inserted in the same logical transaction (no orphan file, no orphan row).
- Upload of a disallowed MIME type returns HTTP 415 `UNSUPPORTED_MEDIA`; upload exceeding 10 MB returns HTTP 413 `PAYLOAD_TOO_LARGE`; in both cases no file is written.
- `POST /api/documents.list` returns the caller patient's non-soft-deleted documents with original filename, mime type, size, and uploaded-at; `documents.delete` soft-deletes the row but leaves the file on disk.
- `GET /api/documents.download?id=…` streams the file with `Content-Disposition: attachment; filename="<original>"`; the patient owner can always download their own document; a doctor can download iff a non-soft-deleted `appointment_document_share` row links the document to a non-soft-deleted appointment whose `doctor_id === ctx.user.id`.
- A doctor calling `documents.download` for a document not shared with them on any appointment returns HTTP 403 `FORBIDDEN`.
- The on-disk filename is a generated UUID; the original filename is never used in the filesystem path (no path-traversal surface).

---

### Feature 4 — Doctor profile & specialization management `p0`

**Module(s):** `accounts`

**Description:** Authenticated doctors view and edit their name and contact info, and manage the subset of seeded specializations they hold (a doctor may hold more than one).

**User story:** As a doctor, I want to edit my name, contact info, and specializations so that patients can find me under the right specialty when booking.

**Acceptance:**
- `POST /api/doctors.getMine` returns the caller doctor's profile (name, contact info, current specialization ids); called with role `patient` returns HTTP 403.
- `POST /api/doctors.updateMine` updates name and contact info; payload validation by Zod returns 422 on shape errors.
- `POST /api/doctors.setSpecializations` accepts a list of specialization ids from the seeded `specialization` table; the resulting `doctor_specialization` rows are the exact set submitted (additions and removals are diffed in one transaction).
- `POST /api/doctors.setSpecializations` with an unknown specialization id returns HTTP 422 `VALIDATION` and changes no rows.
- `POST /api/specializations.list` returns every seeded specialization (id, name, slug) and is callable by both roles when authenticated.
- A doctor with no specializations selected is excluded from the slot-availability results visible to patients (Feature 6 covers the query behaviour).

---

### Feature 5 — Doctor slot management `p0`

**Module(s):** `scheduling`

**Description:** Authenticated doctors create and soft-delete 30-minute bookable slots; only unbooked future slots can be removed.

**User story:** As a doctor, I want to publish 30-minute time slots and remove the ones nobody booked so that patients see my real availability.

**Acceptance:**
- `POST /api/slots.create` with role `doctor` creates a slot owned by the caller with `starts_at` (timestamptz) and fixed `duration = 30 minutes`; returns HTTP 201 with the created slot.
- `POST /api/slots.create` rejects a `starts_at` that is in the past (relative to the server's configured `TZ`) with HTTP 422 `VALIDATION`.
- `POST /api/slots.create` rejects a `starts_at` that overlaps any existing non-soft-deleted slot owned by the same doctor (including unbooked) with HTTP 409 `CONFLICT`.
- `POST /api/slots.delete` sets `deleted_at` on the target slot only when the slot is in the future AND unbooked AND owned by the caller; otherwise returns HTTP 409 `CONFLICT` (booked / past) or HTTP 403 (not owner).
- `POST /api/slots.listMine` returns the caller doctor's non-soft-deleted slots with their booked state and the booking patient's name when applicable.
- A slot's "booked" state is asserted via Feature 6's booking flow: after `appointments.book`, the slot can no longer be reused or soft-deleted.

---

### Feature 6 — Appointment booking flow `p0`

**Module(s):** `appointments`, `scheduling`, `medical-record`

**Description:** A patient selects a specialization, optionally a doctor, sees the union of available 30-minute future slots, picks one, optionally selects which of their own documents to share, and confirms; the booking transaction atomically reserves the slot and inserts one `appointment_document_share` row per shared document.

**User story:** As a patient, I want to pick a specialization, see real available slots, choose a doctor's slot, and attach the documents I want the doctor to see, so that I leave the flow with a confirmed appointment.

**Acceptance:**
- `POST /api/slots.availability` with `{ specializationId, doctorId? }` returns only future, non-soft-deleted, unbooked slots whose owning doctor (a) has the requested specialization in `doctor_specialization` AND (b) matches `doctorId` when supplied; results include doctor id + name + specialization id and are sorted by `starts_at` ascending.
- `POST /api/appointments.book` with `{ slotId, sharedDocumentIds: string[] }` and role `patient` succeeds iff: the slot is in the future, unbooked, not soft-deleted; every `sharedDocumentIds` entry belongs to the caller and is not soft-deleted; the slot's doctor still holds the slot's matched specialization.
- A successful `appointments.book` returns HTTP 201 with the new appointment id; the slot transitions to "booked" (per architecture §8 Q1) within the same transaction; one `appointment_document_share` row exists per shared document.
- A second `appointments.book` against the same `slotId` returns HTTP 409 `CONFLICT` and creates no rows (verified by concurrent integration test).
- `appointments.book` with a `sharedDocumentIds` entry owned by another patient returns HTTP 403 `FORBIDDEN` and creates no rows.
- `appointments.book` with `sharedDocumentIds = []` succeeds and creates the appointment with zero share rows (sharing is optional).
- The created appointment carries the `specialization_id` resolved at booking time so audit history survives a doctor later dropping that specialization.

---

### Feature 7 — Doctor appointment view & structured summary `p0`

**Module(s):** `appointments`, `medical-record`

**Description:** Doctors open an upcoming appointment, see patient identity and the documents the patient shared (downloadable from the moment of booking per brief §6), and after the scheduled start can record a structured **diagnosis (required) + notes (required) + prescription (optional)** summary that marks the appointment complete.

**User story:** As a doctor, I want to see the patient's shared documents and record a structured outcome for an appointment so that the patient ends up with a clear, archived summary of the visit.

**Acceptance:**
- `POST /api/appointments.get` with a doctor-owned appointment id returns the patient's name, the appointment time, the matched specialization, and the list of shared document references (id + original filename + mime); a doctor calling `appointments.get` on an appointment they do not own returns HTTP 403.
- A doctor calling `documents.download` for a shared document on one of their appointments succeeds the moment the appointment is created (no time-gate); verified by an integration test that books a future appointment and downloads immediately.
- `POST /api/appointments.complete` with `{ diagnosis, notes, prescription? }` succeeds only when (a) caller is the appointment's doctor, (b) the appointment is in state `scheduled`, (c) `starts_at <= now()` per server `TZ`, (d) `diagnosis` and `notes` are non-empty strings. Otherwise returns HTTP 409 `CONFLICT` or HTTP 403 with a code identifying the failed precondition.
- A successful `appointments.complete` inserts one `appointment_summary` row (1:1 with the appointment), sets appointment `state = completed` and `completed_at = now()`, and is append-only thereafter: a second `appointments.complete` on the same appointment returns HTTP 409.
- Calling `appointments.complete` before `starts_at` returns HTTP 409 `CONFLICT` with a code distinguishing "too early" from "already completed".
- `POST /api/appointments.listForDoctor` returns the doctor's appointments grouped by state (`scheduled` future, `completed` past), each with patient name, slot time, and a shared-document count.

---

### Feature 8 — Role-aware dashboards `p0`

**Module(s):** `appointments`, `scheduling`, `accounts`

**Description:** A single `/dashboard` route renders different content per role: patients see upcoming and completed appointments plus a "Schedule appointment" CTA; doctors see today's remaining free slots, upcoming appointments, and a "Manage slots" CTA.

**User story:** As a logged-in user, I want one landing page that summarises what's relevant to my role so that I can act on it in one click.

**Acceptance:**
- `POST /api/appointments.listForPatient` (role `patient`) returns two arrays: `upcoming` (state `scheduled`, `starts_at >= now()`, soft-delete-filtered) and `completed` (state `completed`, ordered by `completed_at` desc), each with doctor name + specialization + slot time and (for completed) the summary fields.
- `POST /api/scheduling.todayFreeSlots` (role `doctor`) returns the caller's non-soft-deleted, unbooked slots where `starts_at` is within today's date in the server `TZ`, sorted ascending.
- The UI `/dashboard` route renders the patient view when `auth.me.role === 'patient'` and the doctor view when `auth.me.role === 'doctor'`; an unauthenticated visit redirects to `/login`.
- The patient dashboard's "Schedule appointment" CTA navigates to the multi-step Schedule Appointment route; the doctor dashboard's "Manage slots" CTA navigates to the slot-management route.
- Completed appointments remain visible in the patient list even when the original slot row has been soft-deleted (verified by integration test that books, completes, then soft-deletes the slot).
- The patient dashboard's completed list shows the summary fields read-only; no edit affordance is rendered.

---

### Feature 9 — WCAG 2 AAA accessibility on shipped views `p0`

**Module(s):** UI surface (consumes `apps/ui`, supported by `tailwind` and `shadcn` skills)

**Description:** Every view in brief §12 (Login, Dashboard, Doctor profile, Patient profile, Schedule Appointment form, Appointment details) meets WCAG 2.2 AAA: 7:1 text contrast, full keyboard navigation, screen-reader-labelled controls, visible focus, no keyboard traps, and accessible error states.

**User story:** As a keyboard-only or screen-reader user, I want every shipped MedBridge view to be navigable and labelled correctly so that I can complete every PoC use case without a mouse.

**Acceptance:**
- Every interactive element on every shipped view is reachable via Tab/Shift+Tab in DOM order with a visible focus ring whose contrast ratio against its background is `≥ 3:1` (verified by a manual a11y review checklist committed under `.planning/a11y/`).
- All form fields have programmatic labels (`<label for>` or `aria-labelledby`); error messages are announced via `aria-describedby` and `role="alert"` on submit failure.
- Body text against background has contrast `≥ 7:1`; large text (≥ 18 pt or 14 pt bold) has contrast `≥ 4.5:1`; both verified for every shipped view in the committed checklist.
- The Schedule Appointment multi-step flow is operable end-to-end using keyboard only and announces step transitions to screen readers (verified manually against the checklist).
- No view causes a focus trap; the Esc key dismisses every modal/dropdown and returns focus to the trigger element.
- The committed `.planning/a11y/CHECKLIST.md` file enumerates each view × each WCAG 2.2 AAA criterion with a pass/fail signature, and the review run for v1 is checked in with every criterion marked pass.

---

### Feature 10 — Docker compose deployment & seed `p0`

**Module(s):** deployment (composes all modules), `seed` (one-shot)

**Description:** `docker compose up` from a fresh checkout brings up `ui`, `api`, `postgres`, `api-migrate` (one-shot), and `seed` (one-shot) services; the seed populates specializations, at least one doctor with a specialization and a handful of future slots, at least one patient with medications/conditions/allergies/documents, in idempotent fashion.

**User story:** As a developer evaluating the PoC, I want a single `docker compose up` to produce a running stack with seed data so that I can log in and walk UC-1 through UC-4 without manual DB touches.

**Acceptance:**
- `docker compose up` from a fresh checkout (no prior volumes) completes with `ui`, `api`, and `postgres` healthy; `api-migrate` exits 0 before `api` starts; `seed` exits 0 after `api-migrate`.
- After the stack is up, a seeded patient can log in via the UI at `http://localhost:<UI_PORT>`, see at least one available slot in the Schedule Appointment flow, book it, and the seeded doctor can log in and see that appointment in their upcoming list.
- The seed is idempotent: re-running `docker compose up` against an existing volume does not duplicate `specialization`, doctor, or patient rows.
- The bind-mounted `uploads/` directory and the Postgres named volume both survive `docker compose down` without `-v` and a subsequent `docker compose up` (verified by a smoke script).
- All required env vars (`DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `CSRF_SECRET`, `UPLOAD_DIR`, `TZ`) are documented in `.env.example` at the repo root; the compose file fails fast with a clear error when any are missing.
- The server's `TZ` (e.g. `Europe/Warsaw`) is rendered in the UI for at least one timestamp on the patient dashboard, confirming the single-server-timezone policy is observed end-to-end.

---

### Feature 11 — Doctor visibility into shared medical-record fields `p1`

**Module(s):** `medical-record`, `appointments`

**Description:** Extension to Feature 6: at booking time, the patient may additionally select specific medications, conditions, and/or allergies to share for the appointment (mirroring the document-share pattern), and the doctor sees only those entries at appointment time. Closes brief §12 `OPEN:` and architecture §8 Q6.

**User story:** As a patient, I want to share specific medications/conditions/allergies with a doctor for a specific appointment so that the doctor sees the relevant context without my entire record.

**Acceptance:** *deferred to a v2 feature spec — current acceptance bullets are not yet observable because the share-table shape and UI affordance are not committed; see Open Questions.*

---

### Feature 12 — Completed-appointment exportable summary `p2`

**Module(s):** `appointments`

**Description:** From the appointment details view, a patient can download a print-ready (HTML/PDF) summary of a completed appointment containing the doctor's diagnosis, notes, prescription, and the list of shared document names.

**User story:** As a patient, I want to download a completed-appointment summary so that I can keep an offline copy or hand it to another provider.

**Acceptance:** *deferred to a v3 feature spec — output format (HTML print vs server-rendered PDF) is undecided; current bullets are not yet observable.*

---

## 3. Non-goals

Mirrored from brief §8 ("Scope — out") and held firm by this PRD:

- **No self-service sign-up.** Users are created exclusively by the seed; there is no registration flow, no email verification, no password-reset UI.
- **No appointment cancellation or rescheduling** once booked. A booked slot is final until the doctor marks the appointment complete.
- **No notifications** of any kind — no in-app banners, no email, no SMS, no push, no webhooks.
- **No UI unit, component, or e2e tests** (tech-stack §6 explicitly omits `frontend-testing` and `e2e-testing` skills).
- **No admin UI** for specializations, users, or any other data. Specializations are seeded and immutable in PoC; user management is DB-only.
- **No real PHI.** Seed fixtures are synthetic; HIPAA / GDPR Article 9 obligations are out of scope.
- **No payments, insurance, billing, video, or messaging.** The consultation itself happens out-of-band.
- **No multi-tenant or organisation model.** One deployment is one clinic.
- **No third-party integrations.** No payment processor, calendar provider, email/SMS gateway, identity provider, cloud SDK, or telemetry vendor at runtime (architecture §6.3).
- **No edit-after-complete.** Appointment summaries are append-only after `appointments.complete` returns (architecture §5.1).
- **No per-user timezone.** All timestamps stored and rendered in the single server-configured `TZ`.
- **No hard deletes** in application code. Every delete is soft (`deleted_at` set); the only hard deletes are administrative SQL during seeding.

---

## 4. Constraints (cross-feature)

These apply to every `p0` feature and are inherited by `p1`/`p2` extensions unless explicitly overridden.

### 4.1 Performance

- Internal target (not a contractual SLO): `p95 ≤ 300 ms` for read endpoints against the seeded DB on a developer laptop. Booking transactions allowed up to `p95 ≤ 600 ms` because of the cross-module write + share inserts. Verified informally by a Vitest benchmark file under `apps/api/test/perf/`; no CI gate.
- Single Postgres connection pool per API process; no read replicas; no caching layer.

### 4.2 Security

- **Password hashing:** argon2id with OWASP-2024 baseline params (`m=19456 KiB, t=2, p=1`); passwords never logged or returned.
- **Session:** 15-minute JWT in HttpOnly + Secure + SameSite=Lax cookie issued by `jose`.
- **Refresh:** 7-day rotating refresh token in a second HttpOnly cookie; hash stored server-side in `refresh_token`; revoked on use.
- **CSRF:** double-submit cookie + `X-CSRF-Token` header on every state-changing request; constant-time comparison.
- **RBAC:** every route declares its required role via a `requireRole` wrapper; resource-level ownership checks live in service layer.
- **Upload validation:** MIME whitelist (`image/jpeg`, `image/png`, `application/pdf`), size ceiling 10 MB, generated UUID filename to prevent path-traversal/overwrite.
- **Document-share authorization:** the rule "doctor may read document iff non-soft-deleted `appointment_document_share` links it to a non-soft-deleted appointment the doctor owns" is the most security-sensitive line in the system and has a dedicated unit test (brief §5; architecture §5.4).
- **No HIPAA/GDPR Article 9 certification claims**, only the floor above.

### 4.3 Accessibility

- WCAG 2.2 AAA across every shipped view (Feature 9).
- Tailwind v4 design tokens are tuned to meet AAA contrast ratios by default; Shadcn components are audited individually before reuse.

### 4.4 Auditability

- Soft-delete semantics across every domain entity (`deleted_at` nullable timestamp); historical appointments + summaries + document shares are append-only.
- One structured JSON log line per request: `{ requestId, method, path, status, durationMs, userId? }`. No PII or token values in logs.

### 4.5 Timezone

- Single server `TZ` configured at deploy (e.g. `Europe/Warsaw`). All `starts_at`, `created_at`, `completed_at` rendered to the UI in that one offset. No per-user TZ, no UTC-rendering toggle.

### 4.6 Test coverage floor

- API integration tests cover every `<resource>.<verb>` RPC across UC-1..UC-4 (brief §5; tech-stack §6).
- Unit tests cover the slot-availability algorithm and the document-share authorization rule (brief §5).
- Security-testing suite covers authn-bypass, CSRF failure, RBAC escalation, document-share edge cases, upload validation, and timing-safe password compare (tech-stack §10.2).

---

## 5. Release plan

### v1 — minimum that produces value (`p0` only)

Ships the brief's success criterion: a seeded patient and seeded doctor walk UC-1 → UC-4 end-to-end with `docker compose up` from a fresh checkout.

1. Feature 1 — Authenticated login & session management
2. Feature 2 — Patient medical record CRUD
3. Feature 3 — Medical document upload, listing, and download
4. Feature 4 — Doctor profile & specialization management
5. Feature 5 — Doctor slot management
6. Feature 6 — Appointment booking flow
7. Feature 7 — Doctor appointment view & structured summary
8. Feature 8 — Role-aware dashboards
9. Feature 9 — WCAG 2 AAA accessibility on shipped views
10. Feature 10 — Docker compose deployment & seed

v1 exit signal: every `p0` acceptance bullet has at least one passing verification gate; the committed `.planning/a11y/CHECKLIST.md` shows every shipped view × every WCAG 2.2 AAA criterion marked pass.

### v2 — first stretch (`p1`)

11. Feature 11 — Doctor visibility into shared medical-record fields *(after its acceptance bullets are made observable in the next planning round; resolves brief §12 OPEN and architecture §8 Q6).*

### v3 — second stretch (`p2`)

12. Feature 12 — Completed-appointment exportable summary *(after output format is committed).*

No v4 is contemplated in this PRD; further increments would require a brief refresh.

---

## 6. Open questions

Features whose acceptance bullets are **not yet observable** and are deferred to the next planning round:

1. **Feature 11 — Doctor visibility into shared medical-record fields.** The brief §12 `OPEN:` item and architecture §8 Q6. To make this testable, the next round must commit on (a) whether the share is per-field or per-list, (b) the share-table shape (one table per record type vs a polymorphic share table), and (c) the UI affordance in the Schedule Appointment flow (additional step vs inline selectors).
2. **Feature 12 — Completed-appointment exportable summary.** Acceptance depends on output format (HTML print-stylesheet vs server-rendered PDF via a library). The next round must pick the format and decide whether prescriptions render as plain text or a structured medication list before this feature can be specified.

These are the only PRD-level open questions for v1. Architecture-level open questions (slot booked-state representation, `appointment.specialization_id` source, `packages/contracts` file shape) remain owned by the per-feature `.planning/features/FEATURE-*.md` files the planner produces in the next sprint and do not block v1 acceptance.
