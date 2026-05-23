---
slug: doctor-slot-management
title: "Doctor 30-minute slot creation, listing, and soft-delete"
primary_users: ["doctor"]
depends_on: ["doctor-profile-specializations"]
estimated_task_count: 12
---

# Doctor 30-minute slot creation, listing, and soft-delete

## Summary

Doctors publish 30-minute bookable slots one-at-a-time via a date+time picker, list their slots, and soft-delete unbooked future slots; overlap and past starts_at are rejected.

## Scope

- Drizzle slot table with starts_at timestamptz, owner doctor_id, duration_minutes=30, deleted_at, and booked-state column per architecture §8 Q1
- RPC routes slots.create (one slot per call), slots.delete, slots.listMine
- Service rules: starts_at must be in the future relative to server TZ; rejects overlap against owner's non-soft-deleted slots; delete only on future, unbooked, owner-owned
- Doctor Profile UI extension: "My slots" section with a single date + time picker that submits one slot per Create action, plus a list of upcoming slots with delete affordance
- Integration tests for overlap, past-time, ownership, and booked-state preservation
- Seed extension: a couple of future slots per seeded doctor (enough for booking smoke tests)


## Out of scope

- Bulk / recurring slot creation (one-at-a-time per clarification)
- Variable slot duration (fixed at 30 min in PoC)
- Editing an existing slot's starts_at (delete + recreate only)
- Calendar-grid visualisation (linear list view only)


## Acceptance bullets

- POST /api/slots.create with role=doctor and a future starts_at creates a slot owned by the caller with duration_minutes=30 and returns HTTP 201 with the created slot id and starts_at.
- POST /api/slots.create with a starts_at in the past relative to the server's configured TZ returns HTTP 422 VALIDATION and creates no row.
- POST /api/slots.create with a starts_at that overlaps any existing non-soft-deleted slot owned by the same doctor (booked or not) returns HTTP 409 CONFLICT and creates no row.
- POST /api/slots.delete sets deleted_at on the target slot only when the slot is in the future AND unbooked AND owned by the caller; otherwise returns HTTP 409 CONFLICT (booked or past) or HTTP 403 (not owner).
- POST /api/slots.listMine returns the caller doctor's non-soft-deleted slots with their booked state and (when booked) the booking patient's name.
- The Doctor Profile UI's slot section submits a single date+time picker per Create action and renders the resulting slot list with delete buttons disabled for booked or past rows.

