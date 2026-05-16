---
slug: doctor-appointment-summary
title: "Doctor appointment view + structured diagnosis/notes/prescription summary"
primary_users: ["doctor"]
depends_on: ["appointment-booking"]
estimated_task_count: 18
---

# Doctor appointment view + structured diagnosis/notes/prescription summary

## Summary

Doctors open an upcoming appointment, see the patient's identity, all current medications/conditions/allergies by default, the explicitly shared documents, and prior summaries the same doctor previously wrote for this patient; after the scheduled start they record a structured diagnosis (required) + notes (required) + prescription (optional) that marks the appointment complete.

## Scope

- Drizzle appointment_summary table (appointment_id 1:1, diagnosis text, notes text, prescription text nullable, created_at)
- RPC routes appointments.get (doctor side), appointments.complete, appointments.listForDoctor
- Service: cross-module reads via medical-record public surface to assemble all non-soft-deleted medications/conditions/allergies of the patient (default visibility per clarification)
- Service: prior-summary lookup limited to summaries where the appointment was conducted by the same doctor with the same patient
- Append-only enforcement on appointment_summary (second complete returns 409); state transition scheduled → completed with completed_at = now()
- Doctor UI Appointment Details page: patient identity, full med-record panel, shared documents (download link), prior-summary list, structured summary form gated on starts_at ≤ now()


## Out of scope

- Editing an existing summary after appointments.complete (append-only)
- Doctor visibility into the patient's complete record outside of an appointment context
- Cross-doctor history sharing (only summaries authored by the requesting doctor are returned)
- Exportable summary PDF (deferred to v3 per PRD §5)


## Acceptance bullets

- POST /api/appointments.get with a doctor-owned appointment id returns the patient's name, the slot's starts_at, the matched specialization, the list of shared document references (id + original filename + mime), the patient's full non-soft-deleted medications + conditions + allergies arrays, and the prior-summary list; calling with an appointment the doctor does not own returns HTTP 403.
- The prior-summary list in appointments.get contains exactly those appointment_summary rows whose appointment.doctor_id = caller AND appointment.patient_id = this appointment's patient_id AND state = completed AND deleted_at IS NULL, ordered by completed_at desc — verified by an integration test that seeds three completed appointments across two doctors and asserts only the requester's summaries are returned.
- A doctor calling GET /api/documents.download for a shared document on one of their appointments succeeds the moment the appointment is created (no time-gate) — verified by an integration test that books a future appointment and immediately downloads.
- POST /api/appointments.complete with { diagnosis, notes, prescription? } succeeds only when (a) the caller is the appointment's doctor, (b) state = scheduled, (c) slot.starts_at ≤ now() in the server TZ, (d) diagnosis and notes are non-empty strings; otherwise returns HTTP 409 CONFLICT or HTTP 403 with a code identifying the failed precondition.
- A successful appointments.complete inserts exactly one appointment_summary row, sets appointment.state = completed and completed_at = now(); a second appointments.complete on the same appointment returns HTTP 409 with code distinguishing "already completed" from "too early".
- POST /api/appointments.listForDoctor returns the doctor's appointments partitioned into `scheduled` (future) and `completed` (past) arrays, each item with patient name, slot starts_at, and a shared-document count.
- The Doctor Appointment Details UI shows the full med-record panel, shared-document download links, the prior-summary list, and the structured summary form; the Complete button is disabled until starts_at ≤ now() in the server TZ.

