<!-- version: 1.0.0 -->

# api-integration-testing

## Purpose

Strategy for writing Vitest integration tests in `apps/api/test/integration/*.test.ts` that exercise every `<resource>.<verb>` Hono RPC route against a real Postgres container, using a truncate-and-seed fixture builder, a CSRF+JWT-aware request helper, and uniform `AppError`-envelope assertions.

## Consumers

- `tester` builder persona — produces `apps/api/test/integration/*.test.ts` files.

## Scope

This skill encodes the **integration-testing strategy** only. It does **not** restate:

- Container mechanics (image, ports, startup, teardown) — see `testcontainers` skill.
- Vitest runner config (CLI flags, `vitest.config.ts`, projects, coverage thresholds) — see `vitest` skill.
- Hono app composition, middleware order, `AppError` taxonomy — see `hono` skill and `docs/ARCHITECTURE.md §5.2`.
- Drizzle schema, repo patterns, migration generation — see `drizzle` skill.

## Rules

### Test layout & lifecycle

1. Place every integration test under `apps/api/test/integration/<resource>.<verb>.test.ts`. One file per RPC route family.
2. Start exactly one Postgres container per test file in `beforeAll`, and stop it in `afterAll`. Never share a container across files. See `references/lifecycle.md`.
3. Apply schema via `drizzle-kit migrate` against the container's connection string inside `beforeAll`, after the container is healthy and before any test runs.
4. Construct the Hono `app` once per file after migrations complete; reuse it across tests via `app.fetch(req)` calls.
5. Run truncate-and-seed in `beforeEach`, never in `beforeAll`. State must be deterministic at the start of every `it` block. See `references/fixtures.md`.
6. Never wrap the test body in a transaction to "auto-rollback" state. Service code contains multi-statement transactions that must execute unmodified; nesting them inside an outer test transaction silently masks isolation bugs.
7. Disable Vitest's per-file parallelism within a file (`describe.concurrent` is banned in integration tests) — concurrent `it`s share the same DB and corrupt fixtures. Parallelism across files is allowed because each file owns its own container.

### Fixture builder

8. Truncate before seeding, in a single statement: `TRUNCATE <tables> RESTART IDENTITY CASCADE`. Pass the full table list to avoid FK ordering bugs.
9. Seed a canonical baseline in every `beforeEach`: at least one `organization`, one `patient` user, one `doctor` user, and any role/lookup rows the route requires. Per-test extras are layered on top.
10. Expose the fixture builder as `seed()` returning typed IDs and full rows for every seeded entity. Callers destructure only what they need.
11. Never read auto-generated IDs back via `SELECT` after insert. Use Drizzle's `.returning()` and propagate the IDs through the builder.
12. Password fields seeded for login tests use a pre-hashed argon2id constant from `test/support/passwords.ts`. Never hash inline — argon2 is slow and dominates suite time.

### Request helper

13. All integration HTTP calls go through `request` from `test/support/request.ts`. Never call `app.fetch` directly from a test body — it bypasses cookie/CSRF wiring.
14. The helper exposes `request.get | post | put | delete(path, { body?, as? })`. The `as` field selects the seeded user (`'patient' | 'doctor' | null`); `null` is unauthenticated. See `references/request-helper.md`.
15. The helper maintains an in-memory cookie jar per `request` instance. The jar is reset in `beforeEach` together with the truncate-and-seed.
16. Mint the access JWT in-test via `jose.SignJWT` using the same `JWT_SECRET` the app reads. Cookie name and claims must match the `authRequired` middleware exactly (`sub`, `role`, `orgId`).
17. For state-changing verbs (`POST | PUT | PATCH | DELETE`) the helper auto-sets the `csrf_token` cookie and mirrors its value into the `X-CSRF-Token` header. Tests that intentionally exercise CSRF failure modes pass `{ csrf: 'omit' | 'mismatch' }`.
18. The helper returns `{ status, headers, body }` where `body` is the parsed JSON. Never assert against the raw `Response`.

### Coverage targets

19. Every `<resource>.<verb>` route exported by `apps/api/src/modules/*/routes.ts` must have at least one happy-path test and one explicit failure-path test in this suite.
20. Failure-path tests cover at least: missing auth (`401`), wrong role (`403`), missing CSRF on writes (`403`), Zod validation failure (`422`), not-found (`404`), and any route-specific conflict (`409`).
21. Idempotent routes (those documented as safe to retry — e.g. `appointments.book` with a client-supplied idempotency key) must have a test that issues the same request twice and asserts identical response bodies plus a single row in the target table.
22. Soft-delete routes assert both: (a) the row's `deleted_at` is now non-null, and (b) a subsequent `GET` returns `404`, not the row.

### Error-envelope assertions

23. Assert error responses against the exact envelope `{ error: { code, message, details? } }` from `docs/ARCHITECTURE.md §5.2`. Never assert only on status code.
24. Use the `expectAppError(res, { status, code })` helper from `test/support/assertions.ts`. It checks status, envelope shape, and `error.code` in one call. See `references/assertions.md`.
25. The `code` field is one of the `AppError` subclasses' codes (`VALIDATION_ERROR | NOT_FOUND | UNAUTHORIZED | FORBIDDEN | CONFLICT | UNSUPPORTED_MEDIA | PAYLOAD_TOO_LARGE | INTERNAL_ERROR`). Match the exhaustive list from the `hono` skill.
26. Never assert on `error.message` text — messages are human-readable and not part of the contract. Assert `code` and `details` shape only.

## Format

```
apps/api/test/integration/
  <resource>.<verb>.test.ts        # one file per RPC route family
  ../support/
    container.ts                   # owned by testcontainers skill
    fixtures.ts                    # truncate-and-seed builder
    request.ts                     # cookie+CSRF+JWT helper
    assertions.ts                  # expectAppError, body matchers
    passwords.ts                   # pre-hashed argon2 constants
```

Test-file skeleton:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb } from '../support/container';
import { migrate } from '../support/migrate';
import { makeApp } from '../../src/app';
import { seed } from '../support/fixtures';
import { makeRequest } from '../support/request';
import { expectAppError } from '../support/assertions';

let app: ReturnType<typeof makeApp>;
let request: ReturnType<typeof makeRequest>;
let ctx: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  const db = await startTestDb();         // testcontainers skill owns this
  await migrate(db.url);
  app = makeApp({ db });
  request = makeRequest(app);
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  ctx = await seed();                     // truncates, then re-seeds canonical rows
  request.reset();                        // clear cookie jar + CSRF state
});

describe('appointments.book', () => {
  it('books a free slot for the patient', async () => {
    const res = await request.post('/api/appointments.book', {
      as: 'patient',
      body: { slotId: ctx.slot.id, documentShareIds: [] },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appointment: { patientId: ctx.patient.id, slotId: ctx.slot.id },
    });
  });

  it('rejects unauthenticated callers', async () => {
    const res = await request.post('/api/appointments.book', {
      as: null,
      body: { slotId: ctx.slot.id, documentShareIds: [] },
    });
    expectAppError(res, { status: 401, code: 'UNAUTHORIZED' });
  });

  it('is idempotent on retry with the same key', async () => {
    const body = { slotId: ctx.slot.id, documentShareIds: [], idempotencyKey: 'k1' };
    const first = await request.post('/api/appointments.book', { as: 'patient', body });
    const second = await request.post('/api/appointments.book', { as: 'patient', body });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});
```

## Examples

### CORRECT

A complete test file for `medical-record.update`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb } from '../support/container';
import { migrate } from '../support/migrate';
import { makeApp } from '../../src/app';
import { seed } from '../support/fixtures';
import { makeRequest } from '../support/request';
import { expectAppError } from '../support/assertions';

let app: ReturnType<typeof makeApp>;
let request: ReturnType<typeof makeRequest>;
let ctx: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  const db = await startTestDb();
  await migrate(db.url);
  app = makeApp({ db });
  request = makeRequest(app);
});

afterAll(async () => { await stopTestDb(); });

beforeEach(async () => {
  ctx = await seed();
  request.reset();
});

describe('medical-record.update', () => {
  it('updates the patient\'s own record', async () => {
    const res = await request.post('/api/medical-record.update', {
      as: 'patient',
      body: { allergies: ['penicillin'] },
    });
    expect(res.status).toBe(200);
    expect(res.body.record.allergies).toEqual(['penicillin']);
  });

  it('rejects callers without CSRF header', async () => {
    const res = await request.post('/api/medical-record.update', {
      as: 'patient',
      body: { allergies: [] },
      csrf: 'omit',
    });
    expectAppError(res, { status: 403, code: 'CSRF_INVALID' });
  });

  it('rejects doctors (RBAC)', async () => {
    const res = await request.post('/api/medical-record.update', {
      as: 'doctor',
      body: { allergies: [] },
    });
    expectAppError(res, { status: 403, code: 'FORBIDDEN' });
  });

  it('returns 422 on schema violation', async () => {
    const res = await request.post('/api/medical-record.update', {
      as: 'patient',
      body: { allergies: 'penicillin' }, // wrong type
    });
    expectAppError(res, { status: 422, code: 'VALIDATION_ERROR' });
    expect(res.body.error.details).toEqual(expect.any(Array));
  });
});
```

### INCORRECT — wrapping the test in a transaction

```ts
beforeEach(async () => {
  await db.execute('BEGIN');     // outer transaction to "auto-rollback"
});
afterEach(async () => {
  await db.execute('ROLLBACK');
});

it('books a slot', async () => {
  // service.bookAppointment does BEGIN/COMMIT internally — now nested.
  const res = await request.post('/api/appointments.book', { as: 'patient', body: {...} });
  expect(res.status).toBe(200);
});
```

WHY this is wrong: violates **Rule 6**. The service-layer transaction in `appointments.book` becomes a savepoint inside the outer test transaction. Real-world FK constraint deferral, advisory locks, and `SELECT ... FOR UPDATE` semantics no longer match production. A booking conflict that would fail in prod can pass here. Use truncate-and-seed (Rule 5, Rule 8) instead.

### INCORRECT — sloppy error assertion

```ts
it('rejects expired tokens', async () => {
  const res = await request.get('/api/me.get', { as: 'patient-expired' });
  expect(res.status).toBe(401);                    // status only
});
```

WHY this is wrong: violates **Rule 23** (envelope check missing), **Rule 24** (helper unused), **Rule 26**-adjacent (no `code` assertion). The route could erroneously return a 401 with an unrelated code (`CSRF_INVALID` instead of `UNAUTHORIZED`) and the test would still pass. Use `expectAppError(res, { status: 401, code: 'UNAUTHORIZED' })`.

### INCORRECT — `describe.concurrent`

```ts
describe.concurrent('appointments.book', () => {
  it('books slot A', async () => { /* ... */ });
  it('books slot B', async () => { /* ... */ });
});
```

WHY this is wrong: violates **Rule 7**. Concurrent `it`s share the same Postgres container and the same `beforeEach`'d fixture state. Test B's `seed()` runs while test A is mid-request; both see corrupted data. Cross-file parallelism is fine because each file owns its container; in-file parallelism is not.

### INCORRECT — `app.fetch` bypassing the helper

```ts
it('books a slot', async () => {
  const res = await app.fetch(new Request('app://test/api/appointments.book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slotId: ctx.slot.id }),
  }));
  expect(res.status).toBe(200);    // will be 401: no JWT, no CSRF
});
```

WHY this is wrong: violates **Rule 13**. No JWT cookie is set, no CSRF double-submit is wired, no cookie jar. The route correctly rejects but for transport reasons, not the business reason the test is supposed to exercise. Route the call through `request.post(...)` so auth wiring is uniform.

## Deeper reference

- `references/lifecycle.md` — Vitest `beforeAll`/`afterAll` ordering, container ↔ migration ↔ app construction, parallel-file safety, env scoping.
- `references/fixtures.md` — FK-safe truncate list, canonical seed shape, per-test layering, `.returning()` propagation, password constants.
- `references/request-helper.md` — `makeRequest(app)` API, cookie jar internals, CSRF modes (`'auto' | 'omit' | 'mismatch'`), `jose.SignJWT` claim shape, role-based `as:` resolution.
- `references/assertions.md` — `expectAppError` source, `AppError` envelope, exhaustive `code` enum, `details` shape per subclass.
- `references/pitfalls.md` — Date freezing across container ↔ host, `Date.now()` in CSRF token TTL, leaked containers on `--bail`, port races, drizzle migration cache invalidation.

## Glossary

- **RPC route** — a `<resource>.<verb>` POST/GET endpoint in `apps/api/src/modules/*/routes.ts` (e.g. `appointments.book`). Defined in `docs/ARCHITECTURE.md §6.1`.
- **Truncate-and-seed** — pattern of resetting state by deleting all rows (FK-safe) then re-inserting a canonical baseline, executed once per `it`.
- **Cookie jar** — the request helper's per-instance `Map<name, value>` that survives across multiple HTTP calls within the same `it`, simulating a browser session.
- **CSRF double-submit** — non-HttpOnly `csrf_token` cookie value mirrored into the `X-CSRF-Token` header on writes (`docs/ARCHITECTURE.md §5.4`).
- **AppError envelope** — the uniform JSON shape `{ error: { code, message, details? } }` produced by the `errorHandler` middleware (`docs/ARCHITECTURE.md §5.2`).
