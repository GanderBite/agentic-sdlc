<!-- version: 1.0.0 -->

# vitest

## Purpose

Runner mechanics for Vitest `^2.1.x` as MedBridge's single test runner across `apps/api`, `apps/ui`, and `packages/contracts`. Covers `vitest.config.ts` shape, the `vi` mocking surface, fake timers, watch mode, `--coverage` via `@vitest/coverage-v8`, and project layout. Encodes HOW to run tests; the strategy of WHAT to test lives in `unit-testing`, `api-integration-testing`, and `security-testing`.

## Consumers

- `task-builder` — authors `vitest.config.ts`, picks include globs, wires `vi.mock`/`vi.useFakeTimers` in `*.test.ts` files, runs `pnpm -r test` and `pnpm -r test --coverage`.
- `wave-reviewer` — verifies test files match the expected layout, mocks live in `setupFiles` where appropriate, no skipped/`.only` tests landed.
- `verification-gates` author — wires `pnpm -r test` as the test gate; `pnpm -r test --coverage` for coverage-gated waves.

## Rules

Numbered, imperative, verifiable. Deep material lives under `references/`.

### Config location + shape

1. Every workspace that runs tests ships its own `vitest.config.ts` at the package root (`apps/api/vitest.config.ts`, `apps/ui/vitest.config.ts`, `packages/contracts/vitest.config.ts`). Never put a single root config — workspaces have different `environment` and `include` needs.
2. Always import `defineConfig` from `vitest/config`. Never use `vite`'s `defineConfig` for a Vitest-only package.
3. Pin `test.environment` explicitly: `"node"` for `apps/api` and `packages/contracts`. `apps/ui` MAY set `"jsdom"` even though no test files exist today — leave as `"node"` until a UI test is actually added.
4. Always set `test.globals: false`. Import `describe | it | expect | vi | beforeAll | afterAll | beforeEach | afterEach` from `vitest`. Globals make the test surface implicit and break editor go-to-definition.
5. Always set `test.clearMocks: true`. Reset call state between tests so stale `vi.fn()` assertions never leak across cases.
6. Set `test.include` to a workspace-scoped glob. Unit tests use `src/**/*.test.ts`; integration tests use `test/integration/**/*.test.ts`. Never use the Vitest default (matches the world).
7. Set `test.exclude` to `["node_modules", "dist", "src/**/*.d.ts"]` plus whatever local glob would otherwise cause double-runs.

### Project layout

8. Unit tests are colocated next to source as `<name>.test.ts`. Integration tests live under `apps/api/test/integration/*.test.ts` and run via a separate `pnpm test:integration` script with their own include glob. Never mix the two globs in one config.
9. To run both suites from a single command, use `test.projects` (Vitest 2.1's replacement for the legacy `workspace` field). One project entry per environment/include pair. See `references/projects.md`.
10. Never check in a `.only`, `.skip`, or `it.todo` on a merged commit. The `task-builder` removes them before opening the PR; the `wave-reviewer` rejects PRs that contain them.

### Test API — imports + assertions

11. Use Vitest's built-in `expect`. Do not install Chai, `@vitest/expect-extend`, or `jest-extended`. The Jest-compatible matcher set ships with Vitest.
12. Use TypeScript's path aliases (e.g. `@/foo`) in tests only if the host package already wires them in `tsconfig.json` AND in `vite.config.ts`/`vitest.config.ts` `resolve.alias`. Never rely on `vitest.config.ts` alone — type-checking will diverge from runtime.

### Mocking — `vi.mock`, `vi.spyOn`, `vi.fn`

13. Use `vi.mock(modulePath, factory)` for module-level mocks. The call is **hoisted** to the top of the file before imports — never compute the factory return value from a top-level `const`; capture state inside the factory or via `vi.hoisted`.
14. Use `vi.spyOn(obj, "method")` for partial mocks where the original module is mostly real. Always restore with `mockRestore()` in `afterEach` or rely on Rule 5 + `test.restoreMocks: true` if you also set that.
15. Use `vi.fn()` only for ephemeral stub functions passed into the unit under test. Never use `vi.fn()` to replace an imported function — use `vi.mock` for that.
16. To mock a module that re-exports types alongside values, use `await vi.importActual<typeof import("...")>("...")` inside the factory and spread it. Otherwise type-only re-exports break.

### Fake timers + system time

17. Call `vi.useFakeTimers()` inside `beforeEach` (or per-test) and `vi.useRealTimers()` inside `afterEach`. Never leave fake timers installed across files — Vitest workers reuse modules, real-time waits in another test will hang.
18. Set deterministic system time with `vi.setSystemTime(new Date("2025-01-15T12:00:00Z"))`. Always pass an explicit UTC ISO string. Never use `Date.now()` or `new Date()` without an argument inside a fixture — that defeats determinism.
19. Advance timers with `await vi.advanceTimersByTimeAsync(ms)` for code that awaits inside the timer callback. Use the sync `vi.advanceTimersByTime(ms)` only when no promises are scheduled.

### Lifecycle hooks

20. Lifecycle order is: `beforeAll` (per-file) → `beforeEach` (per-test) → test → `afterEach` (per-test) → `afterAll` (per-file). Hooks defined inside `describe` scope to that block only.
21. Never put async setup that depends on the per-test timer in `beforeAll`. Per-test fake-timer setup goes in `beforeEach`.
22. Per-suite database fixtures (testcontainers) MUST go in `beforeAll` + `afterAll`. See the `testcontainers` skill for the container lifecycle contract.

### Concurrency

23. Use `it.concurrent(...)` ONLY for pure tests with no shared mutable state (no `vi.useFakeTimers`, no shared DB, no `vi.mock` reset). Concurrent tests share the same fake-timer state and the same module-mock registry — assume one will corrupt the other.
24. Use `describe.concurrent(...)` for an entire suite of pure tests, but never combine `describe.concurrent` with `beforeEach` that mutates shared state.
25. Integration tests under `apps/api/test/integration/` MUST NOT use `concurrent`. Each test file already owns a Postgres container; per-file parallelism (Vitest's default) is the right granularity.

### Coverage

26. Use `@vitest/coverage-v8 ^2.1.x`. Never install `@vitest/coverage-istanbul`. V8 is faster, has zero TS source-map gotchas, and matches what `node --experimental-test-coverage` emits.
27. Configure coverage under `test.coverage` in `vitest.config.ts`: `provider: "v8"`, `reporter: ["text", "html"]`, `include: ["src/**/*.ts"]`, `exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/db/migrations/**"]`. Thresholds are set per-feature PRD; never bake a global threshold without one.
28. Invoke as `vitest run --coverage` (or `pnpm test --coverage`). Never wire `--coverage` into the default `test` script — it doubles wall time on every wave run.

### Watch mode + CLI

29. The package `test` script MUST run Vitest in single-shot mode: `"test": "vitest run"`. The default `vitest` command is watch mode and will hang CI. Use a separate `"test:watch": "vitest"` for the local loop.
30. Pass paths or `-t "<name>"` for focused runs. Never pipe `--no-coverage` to disable coverage that was never enabled.

## Schema — `vitest.config.ts` (COMPLETE, for `apps/api`)

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',              // required: 'node' | 'jsdom' | 'happy-dom' | 'edge-runtime'
    globals: false,                   // required: keep explicit imports
    clearMocks: true,                 // required: reset mock call state between tests
    include: ['src/**/*.test.ts'],    // required: workspace-scoped
    exclude: ['node_modules', 'dist', 'src/**/*.d.ts'],
    setupFiles: ['./test/setup.ts'],  // OPTIONAL: global before-all-files hooks
    coverage: {                       // OPTIONAL: only when running --coverage
      provider: 'v8',                 // required when coverage block present
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/db/migrations/**'],
    },
    // For multi-suite layouts (unit + integration in one run):
    // projects: [ ... ]  // see references/projects.md
  },
});
```

Field constraints not in the type system:

- `environment` is one of exactly: `"node" | "jsdom" | "happy-dom" | "edge-runtime"`. No other strings.
- `coverage.provider` is one of: `"v8" | "istanbul" | "custom"`. MedBridge mandates `"v8"` (Rule 26).
- `setupFiles` paths are relative to the workspace root. A bare `"./setup.ts"` resolves against the config file's directory.

## Schema — `package.json` test scripts (MINIMAL)

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run --project integration"
  }
}
```

## Examples

### CORRECT — a unit test with `vi.mock` + fake timers

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findAvailableSlots } from './scheduling';

// Hoisted before imports — Rule 13.
vi.mock('./repo', () => ({
  loadDoctorCalendar: vi.fn(),
}));

import { loadDoctorCalendar } from './repo';

describe('findAvailableSlots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T09:00:00Z')); // Rule 18
  });

  afterEach(() => {
    vi.useRealTimers(); // Rule 17
  });

  it('returns slots after now', async () => {
    vi.mocked(loadDoctorCalendar).mockResolvedValue([
      { start: new Date('2025-01-15T10:00:00Z'), durationMin: 30 },
    ]);

    const slots = await findAvailableSlots('doctor-1');

    expect(slots).toHaveLength(1);
    expect(loadDoctorCalendar).toHaveBeenCalledWith('doctor-1');
  });
});
```

### CORRECT — `vitest.config.ts` for `packages/contracts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
```

### INCORRECT — globals on, watch by default

```ts
// vitest.config.ts
export default defineConfig({
  test: { globals: true },
});
```

```json
// package.json
{ "scripts": { "test": "vitest" } }
```

Violates Rule 4 (globals on) and Rule 29 (watch in `test` script — hangs CI). FIX: set `globals: false`, import from `vitest`, change script to `"vitest run"`.

### INCORRECT — top-level state leaks into hoisted `vi.mock` factory

```ts
const fakeUser = { id: 'u1' };           // evaluated AFTER vi.mock is hoisted
vi.mock('./repo', () => ({ loadUser: () => fakeUser })); // ReferenceError at runtime
```

Violates Rule 13. FIX: use `vi.hoisted` or move the literal inside the factory:

```ts
vi.mock('./repo', () => ({ loadUser: () => ({ id: 'u1' }) }));
```

### INCORRECT — `it.concurrent` with fake timers

```ts
it.concurrent('a', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-15'));
  // ...
});
it.concurrent('b', async () => { /* sees A's system time */ });
```

Violates Rule 23. Fake timers are a process-wide module-level switch; concurrent tests will interfere. FIX: drop `.concurrent` for any test that touches timers, mocks, or shared state.

### INCORRECT — Istanbul coverage provider

```ts
test: { coverage: { provider: 'istanbul' } }
```

Violates Rule 26. FIX: `provider: 'v8'`.

## Deeper reference

- `references/projects.md` — `test.projects` (formerly `workspace`) layout for running unit + integration in one command; per-project `environment`, `include`, `setupFiles` overrides; CLI selection via `--project <name>`.
- `references/mocking.md` — `vi.mock` hoisting model, `vi.hoisted`, `vi.importActual`, `vi.spyOn` restore patterns, mocking ESM-only deps, mocking `Date` vs fake timers, partial module mocks with type-safe `Mocked<typeof mod>`.
- `references/matchers.md` — Vitest's Jest-compatible matcher cheat sheet: equality (`toBe`, `toEqual`, `toStrictEqual`), structure (`toMatchObject`, `toContain`, `arrayContaining`), promises (`resolves`, `rejects`), error shapes (`toThrow(Class)`, `toThrow(/regex/)`), spies (`toHaveBeenCalledWith`, `toHaveBeenNthCalledWith`), snapshots, `expect.assertions(n)`.
- `references/cli.md` — `vitest run | watch | bench`, key flags (`--coverage`, `--reporter`, `-t`, `--project`, `--bail`, `--changed`, `--related`, `--retry`), VS Code extension wiring.

## Glossary

- **Hoisting (`vi.mock`)** — Vitest moves every `vi.mock(...)` call above all imports in the file at parse time. Factories cannot close over module-level constants that depend on imports.
- **Project (`test.projects`)** — a sub-configuration with its own `environment`, `include`, and `setupFiles`. Replaces the legacy `workspace` field in Vitest 2.1.
- **Provider (coverage)** — the backend that instruments code for coverage. V8 uses Node's built-in coverage hooks; Istanbul rewrites the AST. MedBridge mandates V8.
- **Setup file** — a module listed in `test.setupFiles`; runs once per test file before any test, after `beforeAll` is registered. Use for global mocks and env-var seeding.

## Builder protocol

Contract per `verification-gates §R6`. Runs **after edits, before `task.verification`**. Idempotent. Scope: the `*.test.ts` / `*.test.tsx` files this task created or modified.

```sh
# Reject .only / .skip / it.todo in committed test files (Rule 10).
# These are easy to leave in during local iteration and the wave-reviewer
# rejects them — catching at builder time is much cheaper.
if [ -n "${TARGET_FILES}" ]; then
  test_files=$(printf '%s\n' ${TARGET_FILES} | grep -E '\.(test|spec)\.(ts|tsx)$' || true)
  if [ -n "${test_files}" ]; then
    if printf '%s\n' ${test_files} | xargs rg --line-number --no-heading \
        '\b(it|test|describe)\.(only|skip|todo)\b' 2>/dev/null; then
      echo "[vitest builder protocol] .only/.skip/.todo found in committed test file — remove before gates run." >&2
      exit 1
    fi
  fi
fi
```

## Verification recipe

Gates the **planner** may append to any task whose `skills` include `vitest`. First token is `pnpm` (in `build-graph.json → tools`).

```json
{
  "tests": [
    "pnpm --filter <package-that-owns-target-files> test"
  ]
}
```

If a task creates integration tests (path `apps/api/test/integration/**`), additionally emit:

```json
{ "tests": ["pnpm --filter apps/api test:integration"] }
```

Recipe rules:
- **Scope by package**, never `pnpm -r test` for a single-package task.
- Per Rule 29, the `test` script is single-shot (`vitest run`). The planner trusts that; if the gate hangs the failure is a Rule 29 violation in the package, not a planner bug.
- Coverage gates (`test:coverage`) are appended only when an acceptance bullet mentions a coverage threshold.

## Common pitfalls

1. **`.only` / `.skip` / `it.todo` left in a committed test file** (Rule 10). FIX: Builder protocol catches it before gates.
2. **Test runs hang in CI because `test` script omits `run`** (Rule 29). FIX: `"test": "vitest run"`; use `test:watch` for the local loop.
3. **Top-level closure inside hoisted `vi.mock` factory** (Rule 13). Hoisting moves the call above imports — top-level `const`s aren't bound yet. FIX: use `vi.hoisted` or inline the literal.
4. **Module mock leaks across files because timers stay fake** (Rule 17). FIX: `vi.useRealTimers()` in `afterEach`.
5. **`it.concurrent` over shared state** (Rule 23). FIX: drop `.concurrent` for any test that touches timers, mocks, or DB.
