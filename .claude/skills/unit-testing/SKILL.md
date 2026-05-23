<!-- version: 1.0.0 -->

# unit-testing

## Purpose

Strategy for writing **fast, deterministic unit tests against pure service-layer rules** in `apps/api` and `packages/contracts`. Covers what to test (pure logic), what NOT to test (I/O, route wiring, DB), how to structure the file, how to mock the `repo.ts` boundary, and how to make time deterministic. The `vitest` skill owns runner mechanics (config, CLI flags, coverage); this skill is the strategy that calls into it.

## Consumers

- `tester` builder persona — always loads this skill when authoring `*.test.ts` files for service-layer logic.
- `wave-reviewer` — applies these rules when reviewing changes to `*.test.ts` files.

Boundary: defer Vitest config, CLI invocation, and coverage thresholds to the `vitest` skill. Defer real-Postgres / route-level tests to `api-integration-testing`. Defer JWT/CSRF/RBAC negative paths to `security-testing`.

## Rules

### R1 — Scope: pure service logic only

1. Unit-test a function only when it is **pure given its inputs**: same inputs → same outputs, no network, no filesystem, no clock reads, no `process.env` reads, no `db` reads/writes.
2. The two named PoC targets are MedBridge's **slot-availability algorithm** (`scheduling/service.ts`) and the **document-share authorization rule** (`medical-record/service.assertCanDoctorReadDocument`). Every other service rule that meets R1.1 is also in scope.
3. Never unit-test `routes.ts`, `app.ts`, middleware, or `repo.ts` directly. Routes and middleware go to `api-integration-testing`; `repo.ts` is exercised transitively through the integration tests.
4. Never unit-test code from `apps/ui` (brief §8 forbids UI unit tests).
5. If a function under test would need >1 mocked module to be pure, refactor the function first. The test is telling you the seam is wrong.

### R2 — File location and naming

1. Place `*.test.ts` **colocated with the source**, same directory, same basename: `service.ts` → `service.test.ts`.
2. One test file per source file. Do not pool unrelated suites into one file.
3. The top-level `describe` MUST name the unit under test as `<module>.<exportedSymbol>`, e.g. `describe('scheduling.service.computeAvailableSlots', ...)`. Nested `describe` groups MAY refine by branch (`when slot is in the past`).
4. Each `it` block MUST read as `it('when <precondition>, then <observable outcome>', ...)`. No "should". No "works correctly".

### R3 — Structure: Arrange / Act / Assert, one assertion focus per test

1. Every `it` body has three labelled phases. Use blank lines or `// arrange|act|assert` comments — the reviewer scans for both.
2. Each `it` asserts ONE observable outcome. Multiple `expect`s are fine when they describe one outcome (e.g. shape + count of the same return value); they are NOT fine when they cover unrelated branches — split into two `it`s.
3. Build inputs in the test, not in a shared `beforeAll`. Cross-test mutable state is forbidden; `beforeEach` is permitted only for `vi.clearAllMocks()` and `vi.setSystemTime(...)`.

### R4 — Mocking: stop at the `repo.ts` boundary

1. Mock the per-module `repo.ts` and ONLY that file: `vi.mock('./repo')` (relative to the test file) or `vi.mock('../scheduling/repo')` when crossing modules.
2. Never mock `db`, never mock Drizzle, never mock `pg`. The `repo.ts` boundary is the entire I/O surface for service tests by architectural contract (`docs/ARCHITECTURE.md §4`).
3. Mocks return plain in-memory objects shaped like the real return type. Use a typed helper (`makeSlot(overrides)`, `makeAppointmentDocumentShare(overrides)`) in `src/test/factories.ts` rather than inline literals — see `references/patterns.md`.
4. Reset mocks between tests: top of file `beforeEach(() => vi.clearAllMocks())`. Without this, a `mockReturnValueOnce` from the previous test leaks.
5. Never mock a function under test (the service module itself). If you feel the urge, the function is doing two things — split it.
6. Forbidden: `vi.mock('node:fs')`, `vi.mock('pg')`, `vi.mock('drizzle-orm')`, `vi.mock('./db')`. If you need any of these, the test belongs in `api-integration-testing`.

### R5 — Deterministic time

1. Any code that reads the clock (slot-window math, `deleted_at` comparisons, JWT `iat/exp` math in pure helpers) MUST run under fake timers. Set them once per file:
   ```ts
   beforeEach(() => {
     vi.useFakeTimers();
     vi.setSystemTime(new Date('2026-05-14T09:00:00.000+02:00')); // explicit TZ offset
   });
   afterEach(() => vi.useRealTimers());
   ```
2. Always pass an **explicit TZ offset** in the ISO string (single-server-TZ per brief §11; tests must encode the same assumption). Never use bare `new Date('2026-05-14')`.
3. Use `vi.advanceTimersByTime(ms)` to move the clock forward inside a test; never `await new Promise(r => setTimeout(r, ms))` — that hangs under fake timers.
4. Never call the real `Date.now()` directly inside the test body for assertions — read it through the same code path the production code uses, or compare against a frozen literal.

### R6 — Table-driven tests for branch enumeration

1. When a rule has a closed set of branches (slot-window edges, soft-delete states, share-row presence × appointment state), use `it.each` or `describe.each` with a typed `cases` array.
2. Each case row MUST include a `name` field; the `it` title is `'$name'` so failures point at the case unambiguously.
3. Enumerate **every edge** the rule cares about: empty input, single element, two elements at the boundary, soft-deleted, `deleted_at` non-null past, `deleted_at` non-null future, share-row revoked, appointment state `scheduled` vs `completed`. The full PoC enumeration for the two named algorithms lives in `references/edge-cases.md` — copy from there.
4. Use `satisfies` on the cases array to keep type-checking strict without widening to `any`. See R7.

### R7 — Type discipline in tests

1. Tests live under `strict` TS — `any`, `as unknown as X`, and `@ts-expect-error` are forbidden outside the rare branded-ID-construction helper (one such helper, in `src/test/factories.ts`, is sanctioned).
2. Build the `cases` array with `satisfies Array<{ name: string; ...}>` so widening to `string` does not hide a typo'd literal.
3. Import types via `import type { ... }` (matches the `style/useImportType` Biome rule from the `biome` skill).

### R8 — Speed budget (fast-feedback discipline)

1. A single unit test file MUST run in **< 200 ms** wall-clock on a developer laptop. A whole `pnpm test --filter <module>` MUST run in **< 5 s** for any one module.
2. If you breach R8.1, the test is doing I/O — find the leak (a missed `vi.mock`, a real `import('./db')`, a forgotten `await fetch`). Do not raise the budget.
3. Forbidden inside a unit test: `await import('./db')`, `await fetch(...)`, `child_process.exec(...)`, real `fs.readFile` of fixtures (inline the literal or build it programmatically). Reading a JSON fixture from disk via `import` is OK because Vitest bundles it.

### R9 — Test file template

Use this skeleton for every new `*.test.ts`. Annotated; see `references/patterns.md` for filled-in examples for the two PoC algorithms.

```ts
// service.test.ts — colocated with service.ts (R2.1)
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { computeAvailableSlots } from './service';
import type { Slot } from './schema';
import { makeSlot } from '../../test/factories';

// R4: mock the repo boundary and nothing else.
vi.mock('./repo', () => ({
  listSlotsForDoctor: vi.fn(),
}));
import * as repo from './repo';

// R5: deterministic time, set once per file.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-14T09:00:00.000+02:00'));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('scheduling.service.computeAvailableSlots', () => {
  // R6: table-driven for closed branch sets.
  const cases = [
    { name: 'all future, none booked → all returned',     input: [/* slots */], expectedCount: 3 },
    { name: 'one in past → filtered out',                  input: [/* slots */], expectedCount: 2 },
    { name: 'one soft-deleted → filtered out',             input: [/* slots */], expectedCount: 2 },
    { name: 'one already booked → filtered out',           input: [/* slots */], expectedCount: 2 },
  ] satisfies Array<{ name: string; input: Slot[]; expectedCount: number }>;

  it.each(cases)('when $name', ({ input, expectedCount }) => {
    // arrange
    vi.mocked(repo.listSlotsForDoctor).mockResolvedValueOnce(input);

    // act
    const result = computeAvailableSlots({ doctorId: 'doctor-1' });

    // assert
    expect(result).resolves.toHaveLength(expectedCount);
  });
});
```

## Examples

### CORRECT — document-share authorization, one rule, three branches

```ts
// medical-record/service.test.ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { assertCanDoctorReadDocument } from './service';
import { ForbiddenError } from '../../shared/errors';
import { makeShareRow, makeAppointment } from '../../test/factories';

vi.mock('./repo', () => ({
  findShareRow: vi.fn(),
  findAppointmentById: vi.fn(),
}));
import * as repo from './repo';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-14T09:00:00.000+02:00'));
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('medical-record.service.assertCanDoctorReadDocument', () => {
  it('when an active share row links doctor to a non-deleted appointment, then resolves', async () => {
    // arrange
    vi.mocked(repo.findShareRow).mockResolvedValueOnce(makeShareRow({ deletedAt: null }));
    vi.mocked(repo.findAppointmentById).mockResolvedValueOnce(
      makeAppointment({ doctorId: 'doctor-1', deletedAt: null }),
    );

    // act + assert
    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1', documentId: 'doc-1' }),
    ).resolves.toBeUndefined();
  });

  it('when the share row is soft-deleted, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRow).mockResolvedValueOnce(
      makeShareRow({ deletedAt: new Date('2026-05-13T00:00:00.000+02:00') }),
    );

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1', documentId: 'doc-1' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('when no share row exists, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRow).mockResolvedValueOnce(undefined);

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1', documentId: 'doc-1' }),
    ).rejects.toThrow(ForbiddenError);
  });
});
```

WHY correct: scoped to a pure service rule (R1.1, R1.2); colocated and named (R2); AAA structure (R3); mocks only `repo.ts` (R4.1, R4.6); fake timers with explicit TZ (R5.1, R5.2); each `it` asserts one outcome (R3.2); naming follows `when … then …` (R2.4).

### INCORRECT — mocking the DB and reading the real clock

```ts
// scheduling/service.test.ts
import { describe, expect, it, vi } from 'vitest';
import { computeAvailableSlots } from './service';

vi.mock('pg');                       // R4.6: forbidden
vi.mock('./db', () => ({ /*…*/ }));  // R4.6: forbidden

describe('availability works', () => {                   // R2.3: missing module.symbol prefix
  it('should return slots', async () => {                // R2.4: "should", not "when…then"
    const now = new Date();                              // R5.4: real clock read
    const slots = await computeAvailableSlots({ doctorId: 'd1' });
    expect(slots.length).toBeGreaterThan(0);             // R3.2: no precondition asserted
    expect(slots[0].startAt).toBeInstanceOf(Date);
    expect(slots[0].startAt > now).toBe(true);
  });
});
```

WHY wrong:

- `vi.mock('pg')` and `vi.mock('./db')` violate R4.6 — the unit test is reaching past `repo.ts` and effectively becoming a DB integration test.
- The `describe` title is editorial, not `<module>.<symbol>` (R2.3).
- `'should return slots'` violates R2.4 — no precondition, no observable outcome.
- `new Date()` reads the real clock (R5.4) — flaky around midnight in the deployment TZ.
- The body asserts three unrelated facts (length, type, ordering) in one test (R3.2) — when it fails, you cannot tell which rule is broken.
- No `beforeEach(vi.clearAllMocks)` — a future `mockReturnValueOnce` will leak (R4.4).

## Deeper reference

- `references/patterns.md` — filled-in templates for the slot-availability and document-share authorization tests, factory-helper shape, mocking idioms for async/sync repos, `vi.mocked` ergonomics.
- `references/edge-cases.md` — the full enumerated branch list for both PoC algorithms (slot-availability and document-share authorization). Copy rows from here when building `cases` arrays.
