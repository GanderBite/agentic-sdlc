# Strict-mode ergonomics

MedBridge enables `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Each changes inference in ways that catch real bugs and cause one class of friction. Recipes follow.

## `noUncheckedIndexedAccess`

Every indexed read returns `T | undefined`:

```ts
const arr: string[] = ["a", "b"];
const x = arr[0];         // string | undefined  (not string)

const map: Record<string, number> = { a: 1 };
const v = map["b"];       // number | undefined
```

### Recipes

1. Narrow before use:
   ```ts
   const first = arr[0];
   if (first === undefined) return null;
   first.toUpperCase();   // ok
   ```

2. Default with `??`:
   ```ts
   const v = map[key] ?? 0;
   ```

3. Destructure with default:
   ```ts
   const [head = ""] = arr;
   ```

4. For tuple types of known length, the issue does not appear:
   ```ts
   const t: readonly [string, number] = ["x", 1];
   t[0];   // string (in bounds)
   ```

5. Iterate via `for...of` or `forEach` instead of index-based loops when possible:
   ```ts
   for (const item of arr) item.toUpperCase();   // item is string
   ```

### When narrowing is awkward

If a function "knows" the index is valid (e.g. just checked `arr.length`), prefer asserting via a runtime check, not `!`:

```ts
function head<T>(arr: readonly T[]): T {
  const first = arr[0];
  if (first === undefined) throw new Error("head of empty array");
  return first;
}
```

`arr[0]!` is forbidden by Rule 2.

## `exactOptionalPropertyTypes`

The optional marker `?` no longer implicitly admits explicit `undefined`:

```ts
type A = { x?: number };
const a1: A = {};            // ok
const a2: A = { x: 1 };      // ok
const a3: A = { x: undefined }; // TYPE ERROR
```

To allow explicit `undefined`, widen the type:

```ts
type B = { x?: number | undefined };
const b: B = { x: undefined }; // ok
```

### Recipes

1. Prefer absence over explicit `undefined`:
   ```ts
   const payload: A = condition ? { x: value } : {};
   ```

2. When building from a partial source, filter undefined keys instead of forwarding them:
   ```ts
   function compact<T extends object>(o: T): { [K in keyof T]: NonNullable<T[K]> } {
     const out = {} as Partial<T>;
     for (const k in o) if (o[k] !== undefined) out[k] = o[k];
     return out as { [K in keyof T]: NonNullable<T[K]> };
   }
   ```

3. JSON parsing: explicitly model nullable fields with `T | null` over `T | undefined` for wire types — `null` survives `JSON.stringify` and is unambiguous over the wire.

### Common gotcha — spread with optional sources

```ts
function build(over?: { name?: string }): { name?: string } {
  return { name: "default", ...over }; // if over is { name: undefined }, this assigns undefined and FAILS
}
// fix: only spread when over.name is defined, OR widen the return type to { name?: string | undefined }
```

## `strictNullChecks` (subset of `strict`)

- Replace `T | null` returns from libraries with a discriminated `Result` at the API boundary when the null encodes a domain failure with a reason worth carrying.
- For "not found" use `T | null`. For "could not load — here is why" use `Result<T, E>`.

## Object spread under strict mode

Spreading an `any` or `unknown` source widens the destination silently. Always parse/validate before spreading external data.
