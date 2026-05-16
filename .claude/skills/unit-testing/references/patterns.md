# unit-testing — patterns

Deeper material referenced from `SKILL.md`. Filled-in templates for the two PoC algorithms, factory-helper conventions, and mocking idioms. Apply the rules from `SKILL.md` literally; this file shows the shapes only.

---

## 1. Factory helpers (`apps/api/src/test/factories.ts`)

One sanctioned location for typed test factories. Every factory takes a `Partial<T>` of overrides and returns a fully-populated entity matching the Drizzle inferred type. Branded IDs are constructed via a single helper that is allowed to use `as` — this is the only place in the test code where the type system is bypassed (per `unit-testing` R7.1).

```ts
// apps/api/src/test/factories.ts
import type { Slot } from '../modules/scheduling/schema';
import type { AppointmentDocumentShare, Appointment } from '../modules/appointments/schema';
import type { MedicalDocument } from '../modules/medical-record/schema';

// The ONE sanctioned cast. Brand-erased IDs only travel through factories.
function brandId<T extends string>(raw: string): T {
  return raw as T;
}

export function makeSlot(overrides: Partial<Slot> = {}): Slot {
  return {
    id: brandId('slot-1'),
    doctorId: brandId('doctor-1'),
    startAt: new Date('2026-05-14T10:00:00.000+02:00'),
    endAt:   new Date('2026-05-14T10:30:00.000+02:00'),
    bookedAppointmentId: null,
    createdAt: new Date('2026-05-01T08:00:00.000+02:00'),
    deletedAt: null,
    ...overrides,
  };
}

export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: brandId('appt-1'),
    patientId: brandId('patient-1'),
    doctorId: brandId('doctor-1'),
    slotId: brandId('slot-1'),
    specializationId: brandId('spec-1'),
    state: 'scheduled',
    createdAt: new Date('2026-05-10T08:00:00.000+02:00'),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function makeShareRow(overrides: Partial<AppointmentDocumentShare> = {}): AppointmentDocumentShare {
  return {
    id: brandId('share-1'),
    appointmentId: brandId('appt-1'),
    documentId: brandId('doc-1'),
    createdAt: new Date('2026-05-10T08:00:00.000+02:00'),
    deletedAt: null,
    ...overrides,
  };
}

export function makeMedicalDocument(overrides: Partial<MedicalDocument> = {}): MedicalDocument {
  return {
    id: brandId('doc-1'),
    patientId: brandId('patient-1'),
    filename: 'lab-results.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 12_345,
    storedAs: brandId('doc-1.pdf'),
    createdAt: new Date('2026-05-01T08:00:00.000+02:00'),
    deletedAt: null,
    ...overrides,
  };
}
```

**Why factories live in `src/test/` not `test/`**: they are imported by unit tests colocated with source under `src/modules/...`; the `src/` placement keeps imports relative and inside the TS project root. Integration tests under `apps/api/test/integration/` may import them too — see the `api-integration-testing` skill.

---

## 2. Slot-availability — table-driven test

The slot-availability algorithm is the canonical example of a closed-set branch enumeration: every relevant input combination is enumerable. Below: a typical filled-out shape. The full edge list lives in `edge-cases.md`.

```ts
// apps/api/src/modules/scheduling/service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAvailableSlots } from './service';
import { makeSlot } from '../../test/factories';

vi.mock('./repo', () => ({
  listSlotsForDoctor: vi.fn(),
}));
import * as repo from './repo';

const NOW = new Date('2026-05-14T09:00:00.000+02:00');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('scheduling.service.computeAvailableSlots', () => {
  const cases = [
    {
      name: 'three future unbooked → all three returned',
      input: [
        makeSlot({ id: 's1', startAt: new Date('2026-05-14T10:00:00.000+02:00') }),
        makeSlot({ id: 's2', startAt: new Date('2026-05-14T10:30:00.000+02:00') }),
        makeSlot({ id: 's3', startAt: new Date('2026-05-14T11:00:00.000+02:00') }),
      ],
      expectedIds: ['s1', 's2', 's3'],
    },
    {
      name: 'slot starting in the past → filtered out',
      input: [
        makeSlot({ id: 's1', startAt: new Date('2026-05-14T08:30:00.000+02:00') }),
        makeSlot({ id: 's2', startAt: new Date('2026-05-14T10:00:00.000+02:00') }),
      ],
      expectedIds: ['s2'],
    },
    {
      name: 'slot starting exactly at NOW → filtered out (strict future)',
      input: [
        makeSlot({ id: 's1', startAt: NOW }),
        makeSlot({ id: 's2', startAt: new Date('2026-05-14T09:30:00.000+02:00') }),
      ],
      expectedIds: ['s2'],
    },
    {
      name: 'soft-deleted slot → filtered out',
      input: [
        makeSlot({ id: 's1', deletedAt: new Date('2026-05-13T00:00:00.000+02:00') }),
        makeSlot({ id: 's2', startAt: new Date('2026-05-14T10:00:00.000+02:00') }),
      ],
      expectedIds: ['s2'],
    },
    {
      name: 'already-booked slot → filtered out',
      input: [
        makeSlot({ id: 's1', bookedAppointmentId: 'appt-1' as never }),
        makeSlot({ id: 's2', startAt: new Date('2026-05-14T10:00:00.000+02:00') }),
      ],
      expectedIds: ['s2'],
    },
    {
      name: 'empty input → empty output',
      input: [],
      expectedIds: [],
    },
  ] satisfies Array<{ name: string; input: ReturnType<typeof makeSlot>[]; expectedIds: string[] }>;

  it.each(cases)('when $name', async ({ input, expectedIds }) => {
    // arrange
    vi.mocked(repo.listSlotsForDoctor).mockResolvedValueOnce(input);

    // act
    const result = await computeAvailableSlots({ doctorId: 'doctor-1' as never });

    // assert
    expect(result.map((s) => s.id)).toEqual(expectedIds);
  });
});
```

Key points:

- One mock, one boundary (`./repo`). The test never touches Drizzle or `pg`.
- `vi.setSystemTime(NOW)` once per test; `NOW` is a top-level const so cases can reference it.
- `expectedIds` ordering matters — `toEqual` is order-sensitive. If the algorithm sorts by `startAt`, the test enforces that contract too.
- Empty input is a case, not an afterthought.

---

## 3. Document-share authorization — branch table

The document-share rule has a small but security-critical branch set. Use one `describe` and three or four `it`s; a `describe.each` is overkill here.

```ts
// apps/api/src/modules/medical-record/service.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCanDoctorReadDocument } from './service';
import { ForbiddenError } from '../../shared/errors';
import { makeAppointment, makeShareRow } from '../../test/factories';

vi.mock('./repo', () => ({
  findShareRowForDoctorAndDocument: vi.fn(),
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
  it('when active share row + non-deleted appointment + doctor matches, then resolves', async () => {
    vi.mocked(repo.findShareRowForDoctorAndDocument).mockResolvedValueOnce(
      makeShareRow({ deletedAt: null }),
    );
    vi.mocked(repo.findAppointmentById).mockResolvedValueOnce(
      makeAppointment({ doctorId: 'doctor-1' as never, deletedAt: null }),
    );

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1' as never, documentId: 'doc-1' as never }),
    ).resolves.toBeUndefined();
  });

  it('when share row exists but is soft-deleted, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRowForDoctorAndDocument).mockResolvedValueOnce(
      makeShareRow({ deletedAt: new Date('2026-05-13T00:00:00.000+02:00') }),
    );

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1' as never, documentId: 'doc-1' as never }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('when no share row exists, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRowForDoctorAndDocument).mockResolvedValueOnce(undefined);

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1' as never, documentId: 'doc-1' as never }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('when share row links to a soft-deleted appointment, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRowForDoctorAndDocument).mockResolvedValueOnce(
      makeShareRow({ deletedAt: null }),
    );
    vi.mocked(repo.findAppointmentById).mockResolvedValueOnce(
      makeAppointment({
        doctorId: 'doctor-1' as never,
        deletedAt: new Date('2026-05-13T00:00:00.000+02:00'),
      }),
    );

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1' as never, documentId: 'doc-1' as never }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('when the appointment doctor_id does NOT match the requesting doctor, then throws ForbiddenError', async () => {
    vi.mocked(repo.findShareRowForDoctorAndDocument).mockResolvedValueOnce(
      makeShareRow({ deletedAt: null }),
    );
    vi.mocked(repo.findAppointmentById).mockResolvedValueOnce(
      makeAppointment({ doctorId: 'doctor-2' as never, deletedAt: null }),
    );

    await expect(
      assertCanDoctorReadDocument({ doctorId: 'doctor-1' as never, documentId: 'doc-1' as never }),
    ).rejects.toThrow(ForbiddenError);
  });
});
```

Key points:

- Each branch is **one `it`**. When this test goes red, the failure message names the exact branch.
- `ForbiddenError` (not generic `Error`) is asserted — the error taxonomy from `docs/ARCHITECTURE.md §5.2` is part of the contract.
- The doctor-mismatch case proves the rule rejects when the share row appears valid but the appointment's `doctor_id` belongs to a different doctor. This is the most subtle bug the unit test exists to prevent.

---

## 4. `vi.mocked` ergonomics

After `vi.mock('./repo', ...)`, you have two options to type the mocked functions:

```ts
// Option A — vi.mocked wrapper, narrowest scope. Preferred.
import * as repo from './repo';
vi.mocked(repo.listSlotsForDoctor).mockResolvedValueOnce([]);

// Option B — typed mock object at the top of file. Use when many lines reference the same fn.
import * as repo from './repo';
const listSlotsForDoctorMock = vi.mocked(repo.listSlotsForDoctor);
listSlotsForDoctorMock.mockResolvedValueOnce([]);
```

Never write:

```ts
(repo.listSlotsForDoctor as any).mockResolvedValueOnce([]);  // R7.1 violation
```

---

## 5. Async vs sync repo functions

Most `repo.ts` functions are async (`Promise<T>`). Use `mockResolvedValueOnce`. If the function is synchronous (rare; only pure helpers in `repo.ts` qualify), use `mockReturnValueOnce`. Mixing the two silently passes type-checks but produces unhandled rejections at runtime — choose the right one.

---

## 6. What to do when a service function depends on multiple repos

Two acceptable mocks per test file. Both go in the same `vi.mock` factory:

```ts
vi.mock('./repo', () => ({
  findShareRowForDoctorAndDocument: vi.fn(),
  findAppointmentById: vi.fn(),
}));
```

Three or more: pause and re-read `SKILL.md` R1.5. If the seam really is that wide, the test confirms it; refactor the service or escalate to `api-integration-testing` instead.

Cross-module repo dependency (e.g. `appointments/service.ts` reads from `scheduling/repo.ts`):

```ts
vi.mock('../scheduling/repo', () => ({
  findSlotById: vi.fn(),
}));
```

Two `vi.mock` calls, one per imported module, is allowed. Three or more imported repos: re-read R1.5.

---

## 7. Reset discipline

Always:

```ts
beforeEach(() => {
  vi.clearAllMocks();   // wipes call history AND queued mockReturnValueOnce
});
```

Never `vi.resetAllMocks()` at this layer — that also removes the `vi.fn()` instances created by the `vi.mock` factory, breaking every subsequent test.

Never `vi.restoreAllMocks()` for module mocks — it only undoes `vi.spyOn`.
