---
slug: seed-and-deployment-smoke
title: "Full-scale seed, docker-compose hardening, and end-to-end smoke"
primary_users: ["patient","doctor"]
depends_on: ["role-aware-dashboards"]
estimated_task_count: 12
---

# Full-scale seed, docker-compose hardening, and end-to-end smoke

## Summary

Expands the seed to the agreed scale (5 doctors, 15 patients, ~80 slots over 30 days, 3-4 documents per patient, 10 specializations), tightens docker-compose env-var validation and bind-mount persistence, and ships a smoke script that walks a patient → doctor booking + summary cycle end-to-end.

## Scope

- Idempotent seed that produces exactly 10 specializations, 5 doctors (each with 1–3 specializations), 15 patients each with 3–4 medical documents + several medications/conditions/allergies, and ~80 future slots distributed across doctors within the next 30 days
- Bind-mounted uploads/ directory and Postgres named volume verified to survive `docker compose down` (without -v) and a subsequent up
- Compose-level fail-fast for missing required env vars (DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET, CSRF_SECRET, UPLOAD_DIR, TZ) with a clear error
- Smoke shell script that hits the live stack via curl/HTTP to log in as a seeded patient, list availability, book a slot, log in as the seeded doctor, and complete the appointment
- TZ rendering proof: at least one dashboard timestamp string includes the server-configured offset (e.g. +02:00 for Europe/Warsaw)
- .env.example documenting every required variable


## Out of scope

- Production-grade secret management (PoC stays on .env files)
- Health-check endpoints beyond the existing /api/health
- CI deployment workflow (covered separately by .github/workflows/ci.yml in tech-stack §9)
- Backup / restore tooling


## Acceptance bullets

- `docker compose up` from a fresh checkout (no prior volumes) completes with ui, api, and postgres reaching healthy; api-migrate exits 0 before api starts; seed exits 0 after api-migrate.
- After a successful up, the database contains exactly 10 specialization rows, 5 doctor users with 1–3 specializations each, 15 patient users with 3–4 medical_document rows each, and ≥ 80 future slot rows whose starts_at lies within the next 30 days (asserted by a SQL count check committed in the smoke script).
- Re-running `docker compose up` against an existing volume produces no duplicate specialization, doctor_profile, patient_profile, or specialization rows (idempotency asserted by row-count before/after).
- The smoke script logs in as a seeded patient, calls slots.availability, books a slot, then logs in as the slot's doctor and calls appointments.complete — exiting 0 only if every step returns its expected 2xx.
- Performing `docker compose down` (without -v) followed by `docker compose up` preserves uploaded documents on disk and existing DB rows; the smoke script's post-restart check passes against the same fixtures.
- `.env.example` enumerates DATABASE_URL, JWT_SECRET, REFRESH_TOKEN_SECRET, CSRF_SECRET, UPLOAD_DIR, and TZ; starting the stack with any of them unset causes the affected service to exit non-zero with a message naming the missing variable.
- The patient dashboard renders at least one timestamp containing the configured TZ's offset suffix (e.g. matches /\+\d\d:\d\d$/) — asserted by an integration test or the smoke script's HTML scrape.

