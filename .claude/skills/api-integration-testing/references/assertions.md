# assertions.md — error envelope + body matchers

## `expectAppError`

```ts
import { expect } from 'vitest';

type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'UNSUPPORTED_MEDIA'
  | 'PAYLOAD_TOO_LARGE'
  | 'CSRF_INVALID'
  | 'INTERNAL_ERROR';

export function expectAppError(
  res: { status: number; body: unknown },
  want: { status: number; code: AppErrorCode },
): void {
  expect(res.status).toBe(want.status);
  expect(res.body).toMatchObject({
    error: {
      code: want.code,
      message: expect.any(String),
    },
  });
}
```

Three lines of assertion, three things checked: HTTP status, envelope shape, code. Tests that need to look at `details` extend the matcher inline:

```ts
expectAppError(res, { status: 422, code: 'VALIDATION_ERROR' });
expect(res.body.error.details).toEqual(
  expect.arrayContaining([expect.objectContaining({ path: ['email'] })]),
);
```

## Why not assert on `message`

The `message` field is human-readable. It changes when copy is improved or localized. Asserting on it makes tests brittle without buying any coverage — the `code` is the contract.

The only exception: when the route maps multiple business errors to the same `code` (e.g. `CONFLICT` for both "slot taken" and "double-submit"). Then assert on `details.reason` or a sub-code, not the message.

## Status ↔ code mapping (from `docs/ARCHITECTURE.md §5.2` and the `hono` skill)

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing/expired/invalid JWT. Refresh token issues. |
| 403 | `FORBIDDEN` | Authn passed; RBAC or resource-level authorization failed. |
| 403 | `CSRF_INVALID` | Cookie/header mismatch on write. |
| 404 | `NOT_FOUND` | Row absent (or soft-deleted on a read-only endpoint). |
| 409 | `CONFLICT` | Concurrent write, slot taken, duplicate idempotency-key under a different body. |
| 413 | `PAYLOAD_TOO_LARGE` | Upload body > 10 MB. |
| 415 | `UNSUPPORTED_MEDIA` | Upload MIME outside allow-list. |
| 422 | `VALIDATION_ERROR` | Zod parse failure OR business-rule validation (e.g. slot in the past). |
| 500 | `INTERNAL_ERROR` | Anything not derived from `AppError`. Should be vanishingly rare in tests — if it fires, the test caught a real bug. |

Tests that assert `INTERNAL_ERROR` are usually wrong. Either the route is supposed to throw an `AppError` and isn't (fix the route), or the test setup itself is broken (fix the test).

## Body matchers for success responses

Prefer `toMatchObject` over `toEqual` for response-body assertions — it lets the test ignore fields it doesn't care about (timestamps, generated tokens). Pair with `expect.any(...)` and `expect.objectContaining(...)` for the dynamic parts:

```ts
expect(res.body).toMatchObject({
  appointment: {
    id: expect.any(Number),
    patientId: ctx.patient.id,
    slotId: ctx.slot.id,
    status: 'booked',
    createdAt: expect.any(String),
  },
});
```

## Asserting on side effects (DB rows)

For soft-delete and idempotency tests, assertions on the response body alone are insufficient — verify the row state directly:

```ts
const rows = await db.select().from(appointment).where(eq(appointment.slotId, ctx.slot.id));
expect(rows).toHaveLength(1);                   // idempotency: single row, not two
expect(rows[0].deletedAt).toBeNull();           // soft-delete check (when this is a non-delete test)
```

Querying the DB from inside a test is allowed and encouraged for state assertions. The "test through the API only" purism breaks down for soft-delete: the API would happily return `404` regardless of whether the row was deleted, hard-deleted, or never existed. Direct row inspection disambiguates.

## Negative assertions

When a test asserts that something did NOT happen (e.g. a partial-failure rollback left no rows):

```ts
const rows = await db.select().from(appointment);
expect(rows).toHaveLength(0);                   // transaction rolled back, no orphan appointment
```

This is the strongest reason to forbid Rule 6 (test-level transaction wrapping). A test-level outer transaction would make every `INSERT` appear inside the rolled-back outer tx, hiding real partial-write bugs.

## Type assertion shortcut

Use a typed helper if the route's response is exported from `packages/contracts`:

```ts
import type { BookAppointmentResponse } from '@medbridge/contracts/appointments';

const body = res.body as BookAppointmentResponse;
expect(body.appointment.status).toBe('booked');
```

This catches drift between the contract and the route's actual response shape at compile time. The contracts skill (zod) owns the contract definitions.
