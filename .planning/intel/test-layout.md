# Test layout

Snapshot: `1c1ea6393c49b62e98fdc61a77c743b222a459bc`.

> **Status: FRESH REPO.** Sprint-001 was reset (commit `1c1ea63`); no `apps/`, no `packages/`, no `vitest.config.ts`, no test files on disk. The previous layout (API unit + integration projects with `@testcontainers/postgresql`) was deleted alongside the source it tested. This document records the *planned* layout from `docs/APPLICATION.md` so the next sprint has a target to scaffold against.

## Scope (planned)

Per `docs/APPLICATION.md` PoC trade-offs:

- `apps/api`: unit + integration tests (required once the app exists).
- `packages/contracts`: unit tests permitted but optional; `passWithNoTests: true` is the expected default until shared schemas appear.
- `apps/ui`: out of scope for PoC — no UI tests, no e2e.

## Planned layout (NOT yet on disk)

```
apps/api/
  src/
    modules/<feature>/
      <unit>.ts
      <unit>.test.ts            # unit, colocated
  test/
    integration/
      <feature>.<scenario>.test.ts
    support/
      db.ts                     # testcontainers bootstrap
      fixtures.ts               # typed factories
      logCapture.ts             # pino destination for log-scrub tests
      passwords.ts              # cached argon2 hashes for fast seeding
      request.ts                # supertest-like wrapper around Hono fetch

packages/contracts/
  src/
    <schema>.ts
    <schema>.test.ts            # optional
```

## Planned vitest projects

Once `apps/api/vitest.config.ts` lands again, it should define two projects (Vitest v3 projects API):

| Project | Include | Pool | Notes |
|---|---|---|---|
| `unit` | `src/**/*.test.ts` | default | `environment: 'node'`, `globals: false`, `clearMocks: true`. |
| `integration` | `test/integration/**/*.test.ts` | `forks` with `singleFork: true` | Long `testTimeout` (≥60s). Single fork keeps a `@testcontainers/postgresql` instance alive across files so reused containers are not torn down mid-run. |

`packages/contracts/vitest.config.ts` should be a flat config (no projects), `passWithNoTests: true`, `include: ['src/**/*.test.ts']`.

## Planned naming

- **Unit**: `*.test.ts`, colocated next to the source file (e.g. `service.test.ts` next to `service.ts`).
- **Integration**: `<feature>.<scenario>.test.ts` under `apps/api/test/integration/`.
- **Support helpers**: plain names under `apps/api/test/support/`; never `*.test.ts` (they would be picked up as test files).
- No `__tests__/` folders, no `.spec.ts` extension — keep it `*.test.ts` everywhere.

## Planned mock strategy

- **Do not mock the database** in integration tests; use `@testcontainers/postgresql`.
- **Do not mock argon2, JWT signing, or CSRF token generation** in integration tests; each must be exercised end-to-end at least once.
- **Unit tests may inject doubles** for `repo`, `hasher`, `clock`, and `logger` via dependency injection on the service constructor. Use plain in-memory fakes or `vi.fn()` spies; do not patch modules globally.
- **Pino redaction is verified explicitly** by a dedicated log-scrub test using a captured destination stream.

## Re-derivation contract

Once scaffolding lands, `relay run intel-refresh` will replace this placeholder with sections derived from the real `vitest.config.ts` files, the on-disk test tree, and the actual support helpers. Until then, downstream agents must treat the layout above as a planning assumption.
