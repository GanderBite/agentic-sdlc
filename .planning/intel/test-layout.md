# Test layout

Snapshot: `698a63298ece745c06d57a56a863284313daa83f`. Observed from `apps/api/vitest.config.ts`, `packages/contracts/vitest.config.ts`, and the test tree under `apps/api/test/`.

## Scope

Per `docs/APPLICATION.md` PoC trade-offs:

- `apps/api`: unit + integration tests (required, present).
- `packages/contracts`: unit tests permitted; the package currently has none and `vitest.config.ts` sets `passWithNoTests: true`.
- `apps/ui`: out of scope for PoC (no module on disk).

## Layout on disk

```
apps/api/
  src/
    modules/auth/
      service.ts
      service.test.ts            # unit, colocated
    middleware/
    shared/
    db/
  test/
    integration/
      auth.login.test.ts
      auth.logout.test.ts
      auth.refresh.test.ts
      auth.me.test.ts
      auth.csrf.test.ts
      auth.constant-time.test.ts
      auth.concurrent-refresh.test.ts
      auth.token-family.test.ts
      auth.log-scrub.test.ts
      auth.boot-jwt-secret.test.ts
      seed.idempotent.test.ts
    support/
      db.ts                      # testcontainers bootstrap + helpers
      fixtures.ts                # typed factories for users / tokens
      logCapture.ts              # pino destination used by log-scrub tests
      passwords.ts               # cached argon2 hashes for fast seeding
      request.ts                 # supertest-like wrapper around Hono fetch

packages/contracts/
  src/
    auth.ts
    index.ts                     # no *.test.ts yet
```

## Vitest projects

`apps/api/vitest.config.ts` defines two projects in a single config (Vitest v3 projects API):

| Project | Include | Pool | Notes |
|---|---|---|---|
| `unit` | `src/**/*.test.ts` | default | `environment: 'node'`, `globals: false`, `clearMocks: true`. |
| `integration` | `test/integration/**/*.test.ts` | `forks` with `singleFork: true` | `testTimeout: 60000`. Single fork keeps a `@testcontainers/postgresql` instance alive across files so reused containers are not torn down mid-run. |

Run via `pnpm --filter @medbridge/api test` (runs both projects) or `pnpm --filter @medbridge/api exec vitest run --project unit|integration`.

`packages/contracts/vitest.config.ts` is a flat config (no projects), `passWithNoTests: true`, `include: ['src/**/*.test.ts']`.

## Naming

- **Unit**: `*.test.ts`, colocated next to the source file under `apps/api/src/**` (e.g. `service.test.ts` next to `service.ts`).
- **Integration**: `<feature>.<scenario>.test.ts` under `apps/api/test/integration/` (e.g. `auth.refresh.test.ts`, `auth.token-family.test.ts`). One feature group per filename prefix.
- **Support helpers**: plain names under `apps/api/test/support/`; never `*.test.ts` (they would be picked up as test files).
- No `__tests__/` folders, no `.spec.ts` extension — keep it `*.test.ts` everywhere.

## Fixtures

- All fixture factories live in `apps/api/test/support/fixtures.ts` and return typed objects matching the Drizzle row shape (`InferSelectModel<typeof user>` etc.).
- Passwords are pre-hashed once in `apps/api/test/support/passwords.ts` so each test does not pay the argon2 cost; the hash itself is exercised end-to-end at least once in `auth.login.test.ts` / `auth.constant-time.test.ts`.
- Never read real patient data; PoC explicitly forbids it.

## Mock strategy

- **Do not mock the database.** Integration tests must run against the real Postgres provided by `@testcontainers/postgresql` (see `apps/api/test/support/db.ts`). Mocking the DB was an explicit no-go in the auth module's review history — keep it that way for any new feature touching persistence.
- **Do not mock argon2, JWT signing, or CSRF token generation in integration tests.** Each is exercised end-to-end at least once (`auth.constant-time.test.ts`, `auth.csrf.test.ts`, `auth.boot-jwt-secret.test.ts`).
- **Unit tests may inject doubles** for `repo`, `hasher`, `clock`, and `logger` because `createAuthService` accepts them via `AuthServiceDeps`. Use plain in-memory fakes or `vi.fn()` spies; do not patch modules globally.
- **Pino redaction is verified explicitly** by `auth.log-scrub.test.ts` using `apps/api/test/support/logCapture.ts` to attach a destination stream — copy that pattern when adding new sensitive fields.

## Migrations under test

- `apps/api/test/support/db.ts` applies the Drizzle migrations to each testcontainer Postgres instance before tests run. Do not handcraft schema in test setup; if you need a new column, add a migration via `drizzle-kit generate` and let the helper apply it.

## CI / verification commands

See `build-graph.json → per_module["@medbridge/api"]` for the canonical command set. Quick reference:

- All API tests: `pnpm --filter @medbridge/api test`
- Unit only: `pnpm --filter @medbridge/api exec vitest run --project unit`
- Integration only: `pnpm --filter @medbridge/api exec vitest run --project integration`
- Cross-package: `pnpm -r test`
