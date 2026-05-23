# Vitest matcher cheat sheet

Vitest's `expect` is Jest-compatible. This is the subset MedBridge actually uses, grouped by concern.

## Equality

| Matcher                       | Meaning                                                          |
|-------------------------------|------------------------------------------------------------------|
| `expect(a).toBe(b)`           | `Object.is(a, b)`. Use for primitives and reference identity.    |
| `expect(a).toEqual(b)`        | Deep structural equality. Ignores `undefined` properties.        |
| `expect(a).toStrictEqual(b)`  | Like `toEqual` but distinguishes `undefined` props and class identity. Prefer this when class identity matters (e.g. AppError vs plain Error). |
| `expect(a).not.toBe(b)`       | Negation. Chain `.not` once before any matcher.                  |

## Structure / containment

| Matcher                                  | Meaning                                            |
|------------------------------------------|----------------------------------------------------|
| `expect(obj).toMatchObject(partial)`     | All keys in `partial` deep-match `obj`. Extra keys in `obj` are allowed. |
| `expect(arr).toContain(item)`            | `arr.includes(item)` (uses `===`).                |
| `expect(arr).toContainEqual(item)`       | Like `toContain` but deep equality.               |
| `expect(arr).toHaveLength(n)`            | Length check.                                     |
| `expect(obj).toHaveProperty('a.b', val)` | Nested-key value check. `val` is OPTIONAL.        |

## Asymmetric matchers (inside `toEqual` / `toMatchObject`)

```ts
expect(payload).toEqual({
  id: expect.any(String),
  createdAt: expect.any(Date),
  meta: expect.objectContaining({ source: 'api' }),
  tags: expect.arrayContaining(['admin']),
  email: expect.stringMatching(/^[^@]+@example\.com$/),
});
```

## Promises

```ts
await expect(p).resolves.toEqual(value);
await expect(p).rejects.toThrow(AppError);
await expect(p).rejects.toMatchObject({ code: 'E_FORBIDDEN' });
```

Always `await` the assertion. Forgetting the `await` makes the test pass even when the promise rejects.

## Errors

| Matcher                           | Meaning                                          |
|-----------------------------------|--------------------------------------------------|
| `expect(fn).toThrow()`            | `fn()` throws any error.                         |
| `expect(fn).toThrow('substr')`    | Error message contains `'substr'`.               |
| `expect(fn).toThrow(/regex/)`     | Error message matches the regex.                 |
| `expect(fn).toThrow(AppError)`    | Error is an instance of `AppError`.              |
| `expect(fn).toThrow(new AppError('FORBIDDEN'))` | Error message equals the given error's message. |

For async, wrap in an arrow returning the promise, or use `await expect(...).rejects.toThrow(...)`.

## Spies and mocks

```ts
expect(spy).toHaveBeenCalled();
expect(spy).toHaveBeenCalledTimes(2);
expect(spy).toHaveBeenCalledWith('arg', { opt: true });
expect(spy).toHaveBeenLastCalledWith('arg');
expect(spy).toHaveBeenNthCalledWith(1, 'first');
expect(spy).toHaveReturned();
expect(spy).toHaveReturnedWith(value);
```

Use `expect.objectContaining` and `expect.arrayContaining` inside the call args for partial matches.

## Snapshots

Used sparingly in MedBridge — only for stable, human-curated output (error envelopes, generated SQL).

```ts
expect(value).toMatchSnapshot();
expect(value).toMatchInlineSnapshot();
```

Update with `vitest run -u`. Never commit failing snapshots; never run `-u` in CI.

## Defensive assertions

`expect.assertions(n)` declares how many assertions the test SHOULD make. Useful in promise-heavy tests where an early return can silently skip checks:

```ts
it('rejects expired tokens', async () => {
  expect.assertions(2);
  try {
    await verify('expired');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ code: 'E_TOKEN_EXPIRED' });
  }
});
```

`expect.hasAssertions()` is the weaker form: "at least one assertion ran".

## Numerical / floating-point

```ts
expect(0.1 + 0.2).toBeCloseTo(0.3, 5); // 5 decimal places
expect(x).toBeGreaterThan(0);
expect(x).toBeGreaterThanOrEqual(0);
expect(x).toBeLessThan(100);
expect(x).toBeNaN();
```

## Type guards

```ts
expect(x).toBeDefined();    // not undefined
expect(x).toBeUndefined();
expect(x).toBeNull();
expect(x).toBeTruthy();
expect(x).toBeFalsy();
expect(x).toBeInstanceOf(AppError);
```

## What NOT to install

- `chai` — no. `expect` covers everything.
- `jest-extended` — no. Compose `expect.objectContaining` and asymmetric matchers instead.
- `@vitest/expect-extend` — no such MedBridge use case today.
- `sinon` — no. `vi.fn`, `vi.spyOn`, `vi.useFakeTimers` are the equivalents.
