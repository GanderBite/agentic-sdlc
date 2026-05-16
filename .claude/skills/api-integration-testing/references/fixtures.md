# fixtures.md — truncate-and-seed builder

## Goal

Produce a deterministic baseline DB state at the start of every `it`, fast (≤50 ms), with typed handles to every seeded row so tests don't `SELECT` to discover IDs.

## Why TRUNCATE, not DELETE

`TRUNCATE` is one statement, resets identity sequences (so `id` is predictable across runs), and bypasses MVCC overhead. `DELETE FROM ... ` would leave dead tuples accumulating across hundreds of tests, slowing subsequent inserts.

`RESTART IDENTITY` resets `SERIAL`/`bigserial` sequences. `CASCADE` propagates to dependent rows so a single statement is FK-safe regardless of declaration order.

## FK-safe truncate

Always TRUNCATE all application tables in one statement, never one-by-one:

```ts
await db.execute(sql`
  TRUNCATE TABLE
    appointment_document_share,
    appointment_summary,
    appointment,
    slot,
    refresh_token,
    medical_document,
    medical_record,
    doctor_profile,
    user_account,
    organization
  RESTART IDENTITY CASCADE
`);
```

Keep the list synced with `drizzle/schema.ts`. A new table added in a migration must be appended here in the same PR, or fixtures will not reset and tests will see stale data.

## Canonical seed shape

The minimum every test needs:

```ts
type SeedCtx = {
  org: Organization;
  patient: UserAccount & { passwordPlain: 'patient-pw' };
  doctor: UserAccount & { passwordPlain: 'doctor-pw' };
  doctorProfile: DoctorProfile;
  slot: Slot;                          // one free, future slot owned by doctor
};

export async function seed(): Promise<SeedCtx> {
  await truncateAll();
  const [org] = await db.insert(organization).values({...}).returning();
  const [patient] = await db.insert(userAccount).values({
    orgId: org.id, role: 'patient', email: 'p@test', passwordHash: ARGON2_HASH_PATIENT,
  }).returning();
  const [doctor] = await db.insert(userAccount).values({
    orgId: org.id, role: 'doctor', email: 'd@test', passwordHash: ARGON2_HASH_DOCTOR,
  }).returning();
  const [doctorProfile] = await db.insert(doctorProfile).values({
    userId: doctor.id, specialty: 'gp',
  }).returning();
  const [slot] = await db.insert(slot).values({
    doctorId: doctor.id, startsAt: addHours(new Date(), 24), durationMinutes: 30,
  }).returning();
  return {
    org,
    patient: { ...patient, passwordPlain: 'patient-pw' },
    doctor: { ...doctor, passwordPlain: 'doctor-pw' },
    doctorProfile,
    slot,
  };
}
```

## Layering per-test extras

Tests that need more than the baseline call layering helpers, never write raw SQL inline:

```ts
const extraSlot = await seedSlot({ doctorId: ctx.doctor.id, startsAt: addHours(now, 48) });
const booking  = await seedAppointment({ patientId: ctx.patient.id, slotId: extraSlot.id });
```

Each layering helper is a thin `db.insert(...).returning()`. Helpers live alongside `seed()` in `test/support/fixtures.ts`.

## Why pre-hashed passwords

argon2id is intentionally slow (~50–150 ms per hash, by design). Hashing inline inside `seed()` would dominate suite runtime. The constants are precomputed once and committed:

```ts
// test/support/passwords.ts
// Pre-hashed argon2id values for plaintexts 'patient-pw' / 'doctor-pw'.
// Generated locally via scripts/hash-test-passwords.ts; regenerate if argon2 params change.
export const ARGON2_HASH_PATIENT = '$argon2id$v=19$m=...';
export const ARGON2_HASH_DOCTOR = '$argon2id$v=19$m=...';
```

The matching plaintexts are returned from `seed()` so login-flow tests can `body: { email, password: ctx.patient.passwordPlain }`.

## Determinism: time, IDs, randomness

- Identity columns reset on every TRUNCATE → `org.id` is always `1` in the first test of a file, `1` in the second test, etc. Predictable for assertions.
- Date columns set inside `seed()` use `new Date()` (real wall clock). Tests that need frozen time use `vi.setSystemTime` BEFORE calling `seed()`, then unfreeze in `afterEach`.
- UUID columns: if any table uses `gen_random_uuid()`, those IDs are non-deterministic. Tests must not hard-code them — read them from the returned row.

## Common bug: stale Drizzle prepared statements

`drizzle-orm` caches prepared statements per connection. `TRUNCATE` doesn't invalidate them, but `DROP TABLE` would. Since we never drop tables in tests, this is a non-issue — but if you add a teardown that drops tables, you must close + reopen the connection.

## Performance budget

A healthy fixture builder runs in 15–40 ms on a warm Postgres container. If `seed()` is >100 ms, audit:

1. Inline password hashing slipped in — replace with constants.
2. Per-test migration accidentally re-running.
3. Too many `INSERT` round-trips — batch with `db.insert(table).values([...])`.
