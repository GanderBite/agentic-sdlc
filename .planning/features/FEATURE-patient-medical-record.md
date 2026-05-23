---
slug: patient-medical-record
title: "Patient medical record: medications, conditions, allergies CRUD"
primary_users: ["patient"]
depends_on: ["api-scaffold-auth","ui-scaffold-login"]
estimated_task_count: 14
---

# Patient medical record: medications, conditions, allergies CRUD

## Summary

Patients maintain three structured lists (medications, conditions, allergies) with create/list/update/soft-delete via API and a Patient Profile UI surface.

## Scope

- Drizzle tables medication, condition, allergy with patient_id FK and deleted_at
- Zod contracts in packages/contracts for each list's create/list/update/delete operations
- RPC routes medications.{create,list,update,delete} (+ analogous conditions.*, allergies.*) under the medical-record module
- Service-layer ownership checks (patient owns row), soft-delete-only semantics, and role=patient enforcement
- Patient Profile UI page with three list sections, add/edit/delete affordances
- Vitest unit tests for the ownership rule and integration tests covering create/list/update/delete + cross-patient denial
- Seed extension: at least one patient now ships with sample medication, condition, and allergy rows


## Out of scope

- Per-appointment share of these fields (doctor visibility defaults to ALL current entries — see doctor-appointment-summary)
- Bulk import / CSV upload
- Document upload (lives in medical-documents)
- Rich-text or attachment fields on these lists


## Acceptance bullets

- POST /api/medications.create (and analogous conditions.create, allergies.create) with role=patient persists a row scoped to the caller's patient_id and returns the created entity; the same route with role=doctor returns HTTP 403.
- POST /api/medications.list (and analogous routes) returns only the caller's rows where deleted_at IS NULL, ordered most-recent-first.
- POST /api/medications.update returns HTTP 409 CONFLICT when targeting a row with non-null deleted_at and HTTP 403 when targeting a row owned by a different patient.
- POST /api/medications.delete sets deleted_at = now() on the target row and subsequent list calls do not return it, but the row remains in the database (asserted by a *IncludingDeleted repo helper in tests).
- Zod-rejected payloads on any of the three list endpoints return HTTP 422 with a `details` array enumerating each failing field.
- The Patient Profile page renders the three lists and allows add/edit/delete; deletion triggers an optimistic remove and the row no longer appears after refetch.
- A parametrised integration test asserts identical ownership + soft-delete + validation behaviour across all three list types.

