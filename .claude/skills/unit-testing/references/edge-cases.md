# unit-testing — edge-case enumeration

Closed-set branch lists for the two PoC algorithms named in the brief (§5). Copy rows from these tables into your `cases` arrays. If you find a branch the table doesn't enumerate, add it here first, then to the test.

The two algorithms together define the **entire mandatory unit-test surface** for the PoC. Anything else (other pure service rules) is welcome but discretionary.

---

## 1. Slot-availability algorithm

**Source:** `apps/api/src/modules/scheduling/service.ts` — `computeAvailableSlots({ doctorId, ... })` or the cross-doctor variant invoked by `slots.availability` (UC-1). The function returns the set of slots that are bookable **right now** for the given doctor or specialization.

**Architecture contract** (`docs/ARCHITECTURE.md §6` + brief §5): a slot is available iff ALL of the following hold:

1. `startAt > NOW` (strictly future — a slot starting at the current instant is no longer bookable).
2. `deletedAt IS NULL` (not soft-deleted).
3. `bookedAppointmentId IS NULL` (not already booked — exact representation TBD per architecture §8 Q1, but the rule under test is "unbooked").
4. The doctor (or one of the matching-specialization doctors) is not soft-deleted.

The algorithm typically receives an already-filtered repo result for #4; the unit test focuses on rules #1–#3 plus pagination/sorting behavior.

### Branch table

| # | Branch name | Input shape | Expected result | Rule under test |
|---|---|---|---|---|
| 1 | three future unbooked, distinct startAt | 3 slots, all future, all `bookedAppointmentId=null`, all `deletedAt=null` | all 3 returned, sorted by `startAt` ASC | happy path + sort contract |
| 2 | empty input | `[]` | `[]` | empty-set base case |
| 3 | single future unbooked | 1 slot | `[that slot]` | single-element case |
| 4 | slot starting strictly in the past | `startAt = NOW - 30min` | filtered out | rule #1 |
| 5 | slot starting exactly at NOW | `startAt = NOW` | filtered out | rule #1 strict-future boundary |
| 6 | slot starting one millisecond after NOW | `startAt = NOW + 1ms` | returned | rule #1 strict-future boundary |
| 7 | slot soft-deleted, deletedAt in the past | `deletedAt = NOW - 1d` | filtered out | rule #2 |
| 8 | slot soft-deleted, deletedAt in the future (synthetic) | `deletedAt = NOW + 1d` | filtered out | rule #2 — `deletedAt` non-null is the signal, time direction irrelevant |
| 9 | slot already booked | `bookedAppointmentId = 'appt-1'` | filtered out | rule #3 |
| 10 | mix: 2 valid, 1 past, 1 soft-deleted, 1 booked | 5 slots | 2 returned, sorted | composition |
| 11 | all five filter classes fail simultaneously on different slots | 5 slots, each violating a different rule | `[]` | proves no rule is bypassed |
| 12 | two slots with identical `startAt` | both valid | both returned, stable order (by `id` ASC after `startAt`) | tiebreak contract |
| 13 | slot whose `endAt < startAt` (data corruption) | 1 slot | depends on contract — document and assert | input-validation defensive branch |

**Test posture for #13**: the architecture has no explicit defense here. If the service is expected to throw, assert the throw; if it is expected to filter (treat as unbookable), assert filtered. Pick the contract once and pin it in the test.

### What this list does NOT cover (off-scope for unit tests)

- Concurrency between booking and slot-listing — owned by `api-integration-testing` (transactional behavior cannot be unit-tested against mocks).
- The `slot.availability` JOIN across `doctor`, `specialization`, and `doctor_specialization` — that is a query shape concern in `repo.ts`, exercised by integration tests.
- TZ behavior in the rendering layer — owned by `apps/ui` (but no UI tests; rely on a11y review).

---

## 2. Document-share authorization rule

**Source:** `apps/api/src/modules/medical-record/service.ts` — `assertCanDoctorReadDocument({ doctorId, documentId })`. Throws `ForbiddenError` (`docs/ARCHITECTURE.md §5.2`) on denial; returns `void` on grant.

**Architecture contract** (`docs/ARCHITECTURE.md §11.2`, brief §6): a doctor MAY read a `medical_document` iff a non-soft-deleted `appointment_document_share` row exists linking that document to a non-soft-deleted `appointment` whose `doctor_id` equals the requesting doctor.

This is the brief's most security-sensitive rule. Enumerate every denial branch.

### Branch table

| # | Branch name | Share row | Appointment row | Expected | Rule under test |
|---|---|---|---|---|---|
| 1 | active share + non-deleted appointment + doctor matches | `deletedAt=null` | `doctorId='doctor-1', deletedAt=null` | resolve | happy path |
| 2 | no share row exists at all | `undefined` | n/a | `ForbiddenError` | share-presence gate |
| 3 | share row is soft-deleted | `deletedAt=NOW-1d` | n/a (short-circuit) | `ForbiddenError` | share-revocation gate |
| 4 | share row active but appointment soft-deleted | `deletedAt=null` | `doctorId='doctor-1', deletedAt=NOW-1d` | `ForbiddenError` | appointment-soft-delete gate |
| 5 | share row active but appointment's `doctorId` is a different doctor | `deletedAt=null` | `doctorId='doctor-2', deletedAt=null` | `ForbiddenError` | doctor-mismatch gate (the subtle bug case) |
| 6 | share row references a non-existent appointment | `deletedAt=null` | `undefined` | `ForbiddenError` | referential-integrity guard |
| 7 | requesting `doctorId` is empty/falsy | n/a (early return) | n/a | `ForbiddenError` OR upstream auth blocks — pin the contract | input-validation |
| 8 | document does not exist | repo returns `undefined` for the document lookup | n/a | `ForbiddenError` (NOT `NotFoundError` — leaks existence) | enumeration-safety |
| 9 | appointment is in `state='completed'` (post-visit) but otherwise valid | `deletedAt=null` | `state='completed', doctorId='doctor-1', deletedAt=null` | resolve | post-visit access is allowed per brief §6 |
| 10 | appointment is in `state='scheduled'` (pre-visit) but otherwise valid | `deletedAt=null` | `state='scheduled', doctorId='doctor-1', deletedAt=null` | resolve | pre-visit access — brief §6 explicitly says "immediately on booking" |

### Subtleties for the test author

- **Branch #5 (doctor mismatch)** is the highest-value test in the whole suite. A naive implementation that checks "share row exists and isn't soft-deleted" without re-checking `appointment.doctor_id == requesting doctor_id` will pass branches 1–4 and fail #5. Make this case shout.
- **Branch #8 (document doesn't exist)** must return `ForbiddenError`, NOT `NotFoundError`. Returning 404 leaks the existence of documents the doctor isn't authorized to know about. The architecture explicitly classifies this denial under `ForbiddenError (403)`.
- **Branches #9 and #10** prove the rule is **not** gated on appointment state. The brief locked this decision in §6 ("immediately on booking, not deferred to completion"). The test exists to keep someone from "tightening" the rule later.
- **Branch #6** (orphaned share row) probably can't happen if the FK constraint is enabled, but the unit test runs without a DB — assert the defensive branch anyway. The repo mock returns `undefined`; the service must treat that as "no valid grant".

### What this list does NOT cover (off-scope for unit tests)

- The download stream's re-check on the file handle — that's `medical-record/service.streamDocument`, exercised by `api-integration-testing` because it involves real `fs` access.
- The route-level `requireRole('doctor')` gate — that's a middleware concern; goes to `security-testing`.
- The transactional consistency of `appointment_document_share` rows inserted during `appointments.book` — that's `api-integration-testing` (multi-row transaction across modules).

---

## 3. Other pure service rules — discretionary scope

Beyond the two PoC-mandated algorithms, the following pure service rules are good candidates for unit tests if they emerge during implementation. None are mandatory.

- `appointments.completionSummaryValidation` — shape/length/required-field checks on the structured completion payload, if the rule is non-trivial beyond the Zod schema.
- `medical-record.documentUploadValidation` — pure size/MIME validation before the file is touched. The `fs.writeFile` half belongs to integration; the validation half is unit-testable.
- `auth.passwordPolicy` (if any non-trivial rule exists) — pure string checks.
- `slot.geometry` (start/end derivation for a fixed 30-minute slot, given a startAt) — trivially pure; worth a test if there's any chance of off-by-one.

Skip:

- Anything that constructs a Drizzle query — that's a `repo.ts` concern; goes to integration.
- Anything in `routes.ts` — there is no route-level unit test in this project.
- Anything in `middleware/` — those are integration-tested through the route stack.
