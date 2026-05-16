# pitfalls.md — known traps when writing integration tests against a real Postgres

## 1. Module-level DB client reads `process.env` at import time

```ts
// apps/api/src/db/client.ts — BUG when used in tests
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
```

When the test file imports `db` directly, Node evaluates this module BEFORE `beforeAll` runs — `process.env.DATABASE_URL` is whatever the parent shell set (often empty, often pointing at the dev DB). The container's URL is ignored.

**Fix:** wrap construction in a factory and pass the container URL explicitly:

```ts
export function makeDb(url: string) {
  return drizzle(new Pool({ connectionString: url }));
}
```

Tests call `makeApp({ db: makeDb(container.url) })` in `beforeAll`. Production reads env via `makeDb(process.env.DATABASE_URL!)` in `apps/api/src/server.ts`. Same factory, two callers.

## 2. Connection pool not closed → Vitest hangs

A `pg.Pool` keeps the Node event loop alive. If `afterAll` only stops the container but doesn't `pool.end()`, Vitest exits with the dreaded "Tests closed successfully but Node hangs for 30s, then SIGKILL" warning.

**Fix:** the `stopTestDb` helper must:

```ts
await pool.end();          // close client connections
await container.stop();    // SIGTERM container
```

## 3. `Date.now()` mocking leaks across tests

`vi.setSystemTime(new Date('2026-01-01'))` set in `beforeEach` but not cleared in `afterEach` poisons subsequent tests in the same file. The JWT helper's `iat`/`exp` become frozen and tokens fail with `iat in future` errors mysteriously two tests later.

**Fix:** always pair `vi.setSystemTime(...)` with `vi.useRealTimers()` in `afterEach`. Better: scope time mocking to a `describe` block with its own `beforeEach`/`afterEach`.

## 4. Port races on parallel files

`@testcontainers/postgresql` binds a random ephemeral port via `getMappedPort()`. If two files start simultaneously, the OS hands out distinct ports — no conflict. But if a test asserts on a hard-coded port (e.g. `expect(url).toContain(':5432')`), it'll pass locally on a single file and fail in parallel CI runs.

**Fix:** never assert on the container's port. The `url` is opaque.

## 5. Migrations partially applied → schema drift

A test that runs `drizzle-kit migrate` and gets killed mid-migration (CI step timeout) leaves the container in an inconsistent state. Since each file owns its container and the container is fresh, this is rare — but parallel migrations against the same volume (if you mount one) WILL deadlock.

**Fix:** never mount a host volume into the test container. The container's data lives on its own ephemeral filesystem.

## 6. Idempotency-key bug masked by truncate-and-seed

Truncate-and-seed wipes the idempotency-key table between every `it`, so a "second submit with same key returns cached response" test must issue both requests within the same `it`. If the test splits across two `it`s expecting state to persist, `beforeEach` resets and the assertion misleads.

**Fix:** keep idempotency tests in a single `it`; do not span `it` boundaries for state-carrying assertions.

## 7. Race between `beforeAll` migrations and route handlers

If `beforeAll` doesn't `await` the migrate promise, the first test runs against an empty schema. `migrate()` returning fast (e.g. a no-op when already applied locally — except it isn't, the container is fresh) hides the race in most runs but it surfaces on slower CI.

**Fix:** always `await` the migrate call; never use `.then(...)` without returning the promise.

## 8. `expect` matchers that swallow body shape errors

```ts
expect(res.body.appointment.id).toBe(1);  // throws "Cannot read .id of undefined" — looks like a test bug
```

If the route actually returned `{ error: { ... } }` (a 500 instead of 200), the error surfaces as a TypeError, not as the AppError it really is. Frustrating to debug.

**Fix:** always assert on `res.status` first. `expect(res.status).toBe(200)` BEFORE drilling into `res.body`. If status is wrong, you'll see the actual envelope.

## 9. CSRF cookie not echoed → middleware runs in the wrong order

If the test helper sets `X-CSRF-Token` without also setting the `csrf_token` cookie, the middleware sees a header but no cookie and rejects. Easy to spot when written explicitly but the helper does this automatically — the trap is that a developer hand-rolling a request inside a test (Rule 13 violation) forgets and burns 30 minutes debugging.

**Fix:** route every request through the helper. Rule 13 exists for this exact reason.

## 10. Leaked containers on hard kill

`Ctrl-C` on a running test, or `kill -9` on the Vitest process, leaves the Postgres container running. Days later you discover `docker ps` listing 47 zombie containers and your laptop fan is screaming.

**Fix:** `testcontainers` ships a reaper (Ryuk) that does GC on lost sessions. Make sure it's enabled (default in `^10.x`). For local dev, periodically run `docker ps -a | grep testcontainers | awk '{print $1}' | xargs docker rm -f`.

## 11. Drizzle prepared-statement cache + TRUNCATE

`drizzle-orm` caches prepared statements per connection. `TRUNCATE` is fine — it doesn't invalidate prepared plans. But `DROP TABLE` followed by `CREATE TABLE` (e.g. an ad-hoc schema reset in a test) breaks every cached statement. Don't drop tables in tests; use TRUNCATE.

## 12. Argon2 in `beforeEach` blowing the timeout budget

A `seed()` that calls `argon2.hash()` inline takes ~50–150 ms per user. With two users that's 100–300 ms per test, and a 50-test file spends 5–15 seconds purely on password hashing. The Vitest default test timeout (5 s) blows on a 100-test file.

**Fix:** use the pre-hashed constants from `test/support/passwords.ts` (see `fixtures.md`). The plaintext-to-hash mapping is fixed and committed; regenerate only when argon2 parameters change.

## 13. `process.env.NODE_ENV` not set to `'test'` → real CORS, real cookie domain

Production middleware may read `NODE_ENV` to decide cookie `secure` flag, CORS allowlist, etc. If tests run with `NODE_ENV=development`, cookies may set `secure: true` and the in-process `app.fetch` (non-HTTPS) silently drops them.

**Fix:** Vitest sets `NODE_ENV=test` by default. Confirm `apps/api/src/middleware/cookies.ts` treats `'test'` the same as `'development'` for `secure` flag purposes.

## 14. Forgetting to bump the truncate list when a new table is added

When `drizzle generate` produces a migration adding `appointment_reminder`, the developer must also append it to the truncate statement in `fixtures.ts`. If not, tests that touch `appointment_reminder` leak state across `it`s. Symptom: a test passes alone, fails when run after a sibling test.

**Fix:** add a pre-commit check that diffs the table list in `fixtures.ts` against `schema.ts` exports. Out of scope for this skill, but worth a linting rule.

## 15. Container startup races vs. health check

`@testcontainers/postgresql` waits for `pg_isready` by default but on a busy host this may report ready before the server accepts non-loopback connections. The first `pool.connect()` then fails with `ECONNREFUSED` and Vitest reports it as the test failing — masking the real cause.

**Fix:** Add a one-time `await pool.query('SELECT 1')` inside `startTestDb()` after pool creation. If it throws, retry up to 3 times with 100 ms sleeps. Container startup robustness lives in the `testcontainers` skill; this is just a callout for debugging mysterious first-test failures.
