---
slug: role-aware-dashboards
title: "Role-aware /dashboard route for patient and doctor"
primary_users: ["patient","doctor"]
depends_on: ["doctor-appointment-summary","doctor-slot-management"]
estimated_task_count: 11
---

# Role-aware /dashboard route for patient and doctor

## Summary

A single /dashboard route renders per-role content: patients see upcoming + completed appointments and a Schedule CTA; doctors see today's remaining free slots, upcoming appointments, and a Manage Slots CTA.

## Scope

- RPC route appointments.listForPatient returning `upcoming` (state=scheduled, starts_at ≥ now()) and `completed` (state=completed, completed_at desc) arrays with doctor name + specialization + slot time + summary
- RPC route scheduling.todayFreeSlots returning the caller doctor's non-soft-deleted, unbooked slots where starts_at falls within today's date in the server TZ, sorted ascending
- UI /dashboard route loader that branches on auth.me.role and redirects unauthenticated visitors to /login
- Patient dashboard view (upcoming list, completed list with read-only summary, Schedule CTA)
- Doctor dashboard view (today's free slots, upcoming appointments, Manage Slots CTA)
- Integration test: completed appointments remain visible to the patient even after the original slot row is soft-deleted (audit-history invariant)


## Out of scope

- Calendar / timeline visualisations (linear lists only in PoC)
- Counters or analytics widgets
- Filtering or sorting controls beyond the default order
- Notifications / unread badges (brief §8 freezes notifications)


## Acceptance bullets

- POST /api/appointments.listForPatient with role=patient returns `upcoming` and `completed` arrays as specified; each upcoming entry carries doctor name + specialization + slot starts_at; each completed entry additionally carries diagnosis, notes, prescription (the latter may be null).
- POST /api/scheduling.todayFreeSlots with role=doctor returns the caller's non-soft-deleted unbooked slots whose starts_at lies within today's date in the server TZ, sorted ascending — verified by an integration test that seeds slots before/after today and asserts only today's are returned.
- An integration test that books → completes an appointment → soft-deletes the slot still surfaces the appointment in appointments.listForPatient.completed (audit invariant).
- The /dashboard route renders the patient view when auth.me.role === 'patient' and the doctor view when auth.me.role === 'doctor'; visiting /dashboard without a valid session redirects to /login.
- The patient dashboard's Schedule appointment button navigates to the Schedule Appointment route; the doctor dashboard's Manage slots button navigates to the slot management surface.
- The completed-appointments list on the patient dashboard renders the diagnosis / notes / prescription fields read-only with no edit affordance present in the DOM.

