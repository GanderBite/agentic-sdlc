# Vitest mocking — `vi.mock`, `vi.spyOn`, `vi.fn`, `vi.hoisted`

The single most surprising part of Vitest is `vi.mock` hoisting. Internalize this section before writing any test that mocks a module.

## The hoisting rule

Vitest's transformer rewrites every test file so that all `vi.mock(modulePath, factory)` calls execute **before any `import`** in the file — even if you wrote them at the bottom. This is necessary so that subsequent `import` statements resolve to the mocked version, not the real one.

Practical consequences:

1. The factory CANNOT reference any variable declared at module scope, because nothing at module scope has run yet.
2. The factory CAN reference values produced by `vi.hoisted(() => ...)`, because `vi.hoisted` is ALSO hoisted to the top.
3. The factory CANNOT reference an imported symbol from another file, because imports haven't resolved.

### Wrong

```ts
import { realThing } from './lib'; // hoisted import — but factory runs FIRST

const stub = { value: 1 };          // not yet executed when vi.mock runs
vi.mock('./lib', () => ({
  realThing: stub,                  // ReferenceError: Cannot access 'stub' before initialization
}));
```

### Right — inline the literal

```ts
vi.mock('./lib', () => ({
  realThing: { value: 1 },
}));
import { realThing } from './lib';
```

### Right — `vi.hoisted` for shared mock state

```ts
const { mockLoad } = vi.hoisted(() => ({ mockLoad: vi.fn() }));

vi.mock('./repo', () => ({ loadUser: mockLoad }));

import { loadUser } from './repo';

// Later in tests:
mockLoad.mockResolvedValue({ id: 'u1' });
expect(loadUser).toBe(mockLoad); // same identity
```

## Partial mocks with `vi.importActual`

When you want to mock ONLY some named exports and keep the rest real:

```ts
vi.mock('./repo', async () => {
  const actual = await vi.importActual<typeof import('./repo')>('./repo');
  return {
    ...actual,
    loadUser: vi.fn(),
  };
});
```

The generic on `importActual` is critical — without it, the spread loses type information and the test file no longer type-checks against the real module.

## Type-safe access with `vi.mocked`

After a `vi.mock`, the imported symbol's runtime is a `Mock`, but its static type is the original. Wrap it with `vi.mocked` to recover the Mock API in a type-safe way:

```ts
import { loadUser } from './repo';
vi.mock('./repo', () => ({ loadUser: vi.fn() }));

vi.mocked(loadUser).mockResolvedValue({ id: 'u1' });          // ok
vi.mocked(loadUser).mock.calls[0]; // typed as Parameters<typeof loadUser>
```

For deep recursive typing on objects: `vi.mocked(obj, { deep: true })`.

## `vi.spyOn` — wrap, don't replace

Use `vi.spyOn(obj, "method")` when:

- You want the original implementation to keep running AND record calls.
- You're mocking a class instance method or a namespaced helper.
- You want easy `mockRestore()` to put the real method back.

```ts
import * as crypto from 'node:crypto';

const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000000');

// ... assertions ...

spy.mockRestore(); // crypto.randomUUID is the real function again
```

`vi.spyOn` does NOT need hoisting because it mutates the target object at runtime. Place it inside `beforeEach` or per-test.

## `vi.fn` — ephemeral stubs

Use `vi.fn()` for callbacks passed INTO the unit under test, not for replacing imports.

```ts
const onError = vi.fn();
mySubject.run({ onError });
expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'E_BAD' }));
```

You can give it a default implementation: `vi.fn((x: number) => x * 2)`. Override per-test with `mockImplementation`, `mockReturnValue`, `mockResolvedValue`, `mockRejectedValue`.

## Reset, clear, restore — which one when

| Method                      | Effect                                                      | When to use                              |
|-----------------------------|-------------------------------------------------------------|------------------------------------------|
| `mockFn.mockClear()`        | Clears `.mock.calls` and `.mock.results`. Keeps impl.       | Inside a test before re-using a stub.    |
| `mockFn.mockReset()`        | Clear + remove implementation; impl becomes `() => undefined` | When you want a fresh, blank mock.      |
| `mockFn.mockRestore()`      | Reset + restore the ORIGINAL impl (only for `vi.spyOn`).    | In `afterEach` to undo a spy.            |
| `vi.clearAllMocks()`        | `mockClear` on every tracked mock.                          | In `beforeEach` — or set `clearMocks: true`. |
| `vi.resetAllMocks()`        | `mockReset` on every tracked mock.                          | Almost never; prefer `clearMocks`.       |
| `vi.restoreAllMocks()`      | `mockRestore` on every spy.                                 | In `afterEach` for spy-heavy files; or set `restoreMocks: true`. |

MedBridge config sets `clearMocks: true` globally (Rule 5). You do not need to call `vi.clearAllMocks()` in `beforeEach` — it happens automatically.

## Mocking timers vs mocking `Date`

`vi.useFakeTimers()` patches `setTimeout`, `setInterval`, `setImmediate`, `requestAnimationFrame`, AND `Date`. Use `vi.setSystemTime(new Date(iso))` to control the clock. The patched `Date` is restored by `vi.useRealTimers()`.

Do NOT independently spy on `Date.now`; `vi.useFakeTimers` already owns it. Combining the two leads to double-restore confusion.

## Common pitfalls

- **Mocking a Node built-in** (e.g. `fs/promises`): use the full specifier including the `node:` prefix if the source uses it. Mocks key on the exact import string.
- **Mocking a default export**: the factory must return `{ default: vi.fn() }`. Forgetting the wrapper makes the default `undefined`.
- **ESM-only deps**: Vitest handles them natively. No `__esModule: true` flag, no `jest.unstable_mockModule` equivalent needed.
- **Module not actually replaced**: ensure the path string is byte-identical to the one in the SUT's `import` statement. `'./repo'` and `'./repo.ts'` are different mock keys in Vitest 2.1.
