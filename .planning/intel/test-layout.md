# Test layout

> **Fresh repo.** No tests exist on disk. The conventions below are planned, derived from `docs/APPLICATION.md`. Update once the first test file lands and `intel-refresh` runs.

## Scope
Per APPLICATION.md PoC trade-offs:
- `apps/api`: unit + integration tests (required).
- `apps/ui`: **no** unit, integration, or e2e tests in PoC scope.

## Planned location

```
apps/api/
  src/
    <feature>/
      <thing>.ts
      <thing>.test.ts            # unit, colocated
  tests/
    integration/
      <feature>.spec.ts          # integration, hits real Postgres
    fixtures/
      doctors.ts patients.ts ... # seed data
    helpers/
      db.ts http.ts              # bootstrap a test container + auth helpers
```

## Naming
- Unit: `*.test.ts` next to source.
- Integration: `*.spec.ts` under `apps/api/tests/integration/`.
- No `__tests__` folders — keep colocation flat.

## Fixtures
- All test data under `apps/api/tests/fixtures/`. Factories return typed objects matching Drizzle schema rows.
- Never read real patient data; the system explicitly forbids it (APPLICATION.md "Security").

## Mock strategy
- **Do not mock the database.** Integration tests must run against a real Postgres (Docker Compose service or testcontainers).
- External-but-trivial dependencies (clock, uuid, file system for uploads) may be injected behind a port interface and faked in unit tests.
- Argon2, JWT signing, and CSRF token generation must be exercised end-to-end at least once in integration; never globally stub crypto.

## Test runner
- Not yet chosen — the `tech-stack` step decides. The placeholder `build-graph.json` will be filled in by `intel-refresh` once the runner appears in `package.json`.
