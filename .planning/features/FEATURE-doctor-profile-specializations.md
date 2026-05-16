---
slug: doctor-profile-specializations
title: "Doctor profile + seeded specializations management"
primary_users: ["doctor"]
depends_on: ["api-scaffold-auth","ui-scaffold-login"]
estimated_task_count: 11
---

# Doctor profile + seeded specializations management

## Summary

Authenticated doctors view and edit their name, contact info, and the subset of seeded specializations they hold; a seeded immutable list of 10 specializations is exposed for both roles.

## Scope

- Drizzle tables specialization (seeded), doctor_profile, doctor_specialization M2M
- Seed: exactly 10 specializations (id, name, slug) generated at seed time and idempotent on re-run
- RPC routes doctors.getMine, doctors.updateMine, doctors.setSpecializations, specializations.list
- Set-diffing in doctors.setSpecializations (additions + removals in one transaction)
- Doctor Profile UI page with name/contact form and multi-select specialization picker bound to the seeded list
- Role enforcement: only doctors hit doctors.* mutations; both roles may list specializations


## Out of scope

- Admin UI to mutate the specialization list (brief: immutable in PoC)
- Doctor slot management (lives in doctor-slot-management)
- Doctor photo / avatar upload
- Per-doctor bio / long-form text fields


## Acceptance bullets

- POST /api/specializations.list returns exactly 10 specialization rows (id, name, slug) when called by either an authenticated patient or doctor.
- POST /api/doctors.getMine with role=doctor returns the caller's profile (name, contact info, current specialization ids); the same route with role=patient returns HTTP 403.
- POST /api/doctors.updateMine updates name and contact info; Zod shape errors return HTTP 422 with a `details` array.
- POST /api/doctors.setSpecializations accepts a list of specialization ids and makes the resulting doctor_specialization rows equal to the submitted set (additions inserted, removals soft-deleted) within a single transaction; integration test confirms set equality after add+remove+overlap inputs.
- POST /api/doctors.setSpecializations with at least one unknown specialization id returns HTTP 422 VALIDATION and changes no rows (asserted by row-count before/after).
- The Doctor Profile UI renders the multi-select against specializations.list and persists changes via doctors.setSpecializations; subsequent getMine returns the updated set.

