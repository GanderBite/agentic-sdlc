# Test layout

Snapshot: `1c8d5d1707e5aa47d37c987e847cd6ae0fcc2a41`.

Derived from the on-disk vitest configs and the actual test tree shipped
in sprint-002 (`api-scaffold-auth`).

## Scope

- `apps/api` — unit + integration tests. Only **integration** tests exist on
  disk today (`apps/api/test/integration/*.test.ts`); the unit project is
  configured but its include pattern matches no files yet (`passWithNoTests:
  true` keeps the run green).
- `packages/contracts` — no test runner configured yet. Add one when shared
  schemas grow non-trivial validation logic.
- No UI app, no end-to-end suite — out of PoC scope per `docs/APPLICATION.md`.

## On-disk layout

```
apps/api/
  vitest.config.ts                   # unit project
  vitest.integration.config.ts       # integration project (separate config)
  test/
    integration/
      auth.login.test.ts
      auth.refresh.test.ts
      auth.session.test.ts
      csrf.test.ts
      log-redaction.test.ts
      seed.test.ts
    support/
      container.ts                   # startPostgres() — Testcontainers + drizzle migrate
      fixtures.ts                    # seedFixtures(db) — deterministic users
      assertions.ts                  # expectAppError(...) + cookie/header helpers
      logCapture.ts                  # pino destination stream for log-scrub
      passwords.ts                   # re-export of src/shared/password.ts (no divergent wrapper)
      request.ts                     # buildClient(app) — fetch wrapper + loginAs helper

packages/contracts/
  (no test files yet)
```

There are NO unit `*.test.ts` files in `apps/api/src/**` at this snapshot.

## Vitest configuration

| Project | Config | Include | Sequencing | Timeout |
|---|---|---|---|---|
| unit | `apps/api/vitest.config.ts` | `src/**/*.test.ts`, `test/unit/**/*.test.ts` | default (parallel) | default |
| integration | `apps/api/vitest.integration.config.ts` | `test/integration/**/*.test.ts` | `fileParallelism: false`, `sequence.concurrent: false` | `testTimeout: 60000` |

Both configs set `environment: 'node'`, `globals: false`, `clearMocks: true`.
The unit config also wires coverage (`@vitest/coverage-v8`, `provider: 'v8'`,
reporters `text` + `html`), excluding `*.test.ts`, `*.d.ts`, and
`src/db/migrations/**`.

## Commands

- Unit (currently zero tests, exits green): `pnpm -F @medbridge/api test`
- Integration (Testcontainers; requires Docker): `pnpm -F @medbridge/api test:integration`
- Watch: `pnpm -F @medbridge/api test:watch`

## Naming

- **Unit** (when added): `*.test.ts`, colocated next to the source file.
- **Integration**: `<feature>.<scenario>.test.ts` under `apps/api/test/integration/`
  (e.g. `auth.login.test.ts`, `auth.refresh.test.ts`, `auth.session.test.ts`).
- **Support helpers**: plain names under `apps/api/test/support/` — never
  `*.test.ts`, or they will be picked up as test files.
- No `__tests__/` folders, no `.spec.ts` suffix.

## Testcontainers / DB strategy

- `apps/api/test/support/container.ts` exports `startPostgres()` which boots a
  `PostgreSqlContainer` (`@testcontainers/postgresql`), opens a `pg.Pool`,
  builds a drizzle instance, and runs `migrate(db, { migrationsFolder:
  apps/api/src/db/migrations })` so the test DB matches production exactly.
- **One container per test file**. The integration config sets
  `fileParallelism: false` and `sequence.concurrent: false` so containers are
  not torn down mid-suite, and tests within a file share a single container
  via `beforeAll`/`afterAll`.
- `testTimeout: 60000` (60s) accommodates container startup; container start
  inside `beforeAll` typically passes `60_000` explicitly as well.

## Mock strategy

- **Never mock the database** — always go through a real container.
- **Never mock argon2** in integration tests. The `passwords.ts` support
  helper re-exports the production module (no divergent wrapper) so spies
  attached to the production module path intercept service calls too.
- **Never mock the JWT signer or CSRF token generator** end-to-end — they
  must be exercised at least once per suite.
- **Spy targets**: ESM bindings are live, so `vi.spyOn` only intercepts when
  the spied import path matches the path the service actually imports from.
  In auth tests, spy on `src/shared/password.js` (the production module), not
  on a re-export from `test/support/passwords.ts`. See `do-not-recur.md`
  (F-001) and `.claude/agent-memory/wave-reviewer/` for the recurring failure
  mode this was added to prevent.
- **Unit tests may inject doubles** for `repo`, `hasher`, `clock`, and
  `logger` via the dependency object on `createAuthService`. Use plain
  in-memory fakes or `vi.fn()` spies; do not patch modules globally.

## Log redaction tests

`apps/api/test/integration/log-redaction.test.ts` pipes the pino logger to
a captured destination stream (`test/support/logCapture.ts`) and asserts that
each sensitive field appears as `[REDACTED]`. This is the canonical test for
the redact-paths invariant documented in `conventions.md` and must be updated
whenever a new sensitive field is logged.

## Seed credentials used in tests

Tests that need authenticated requests call `seedFixtures(db)` and then
`buildClient(app).loginAs('patient' | 'doctor')`. The deterministic seeded
accounts are:

| Email | Password | Role |
|---|---|---|
| `patient@medbridge.test` | `patientpass123!` | `patient` |
| `doctor@medbridge.test` | `doctorpass123!` | `doctor` |

Source: `apps/api/src/seed/fixtures/users.json`. The seeder is idempotent
(skips existing emails).
