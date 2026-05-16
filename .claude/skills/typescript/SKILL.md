<!-- version: 1.0.0 -->

# typescript

## Purpose

Idiomatic TypeScript 5.7 patterns for the MedBridge monorepo under `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Covers type-design primitives (branded types, discriminated unions, `satisfies`, `as const`), strict-mode ergonomics, and module hygiene for `apps/api`, `apps/ui`, and `packages/contracts`.

## Consumers

- `builder` — writes `.ts` source under the rules below.
- `reviewer` — checks PRs against these rules before approving.
- `sprint-planning` — references this skill when scoping TS-touching tasks.

## Project facts (do not relitigate)

- TypeScript `^5.7` across all workspaces.
- `tsconfig.json` enables: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Treat all three as non-negotiable.
- No `.js` source files. `.ts` only. Compiled `.js` lives in `dist/` and is never edited.
- `apps/api` compiles with `tsc` (no bundler). Entry: `dist/main.js`. Dev runs `tsx`.
- `packages/contracts` is consumed via `workspace:*`; types cross workspace boundaries — make them stable.

## Rules

### Type discipline

1. Never use `any`. Use `unknown` and narrow with a type predicate or schema parse.
2. Never use non-null assertion `!` to silence the compiler. Refactor or narrow with a guard.
3. Never use `as T` to cast away type errors. The only allowed casts are `as const`, `as unknown as T` (with a comment justifying it), and parser output (e.g. `zod.parse` already returns `T`).
4. Annotate every exported function's parameters and return type explicitly. Inference is allowed only for local variables and non-exported helpers.
5. Prefer `type` for object shapes, unions, and mapped types; use `interface` only when declaration merging is required.
6. Use `readonly` on every array, tuple, and object field that is not deliberately mutated after construction.

### Strict-mode ergonomics (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)

7. Treat every `arr[i]`, `record[key]`, and `tuple[n]` (out-of-known-bounds) as `T | undefined`. Narrow with `if (x === undefined) ...` or `?.` before use. Never assume defined.
8. Distinguish missing from present-undefined. With `exactOptionalPropertyTypes`, `{ a?: string }` permits `{}` and `{ a: "x" }` but rejects `{ a: undefined }`. Write `a?: string | undefined` only when explicit `undefined` must be assignable.
9. Use `Map`/`Set` over object-as-dictionary when keys are dynamic. `Record<K, V>` only when `K` is a known string-literal union.

### Type design primitives

10. Model identifiers and units with branded types (see `references/branded-types.md`). Never pass a raw `string` where a `PatientId` is expected.
11. Model variant data as discriminated unions with a literal `kind` (or `type`) tag. Never overload one shape with all-optional fields. See `references/discriminated-unions.md`.
12. Use `satisfies T` to type-check a literal while preserving its narrow inferred type. Use `: T` only when widening is intended. See `references/satisfies-and-as-const.md`.
13. Use `as const` on literal arrays/objects whose values must remain literal-typed (enum-like, route tables, error codes).
14. Enforce exhaustiveness on discriminated-union `switch` with a `never` default: `default: const _exhaustive: never = x; throw new Error(...)`.

### Imports and module hygiene

15. Use `import type { Foo } from "..."` for type-only imports. Use inline `import { type Foo, bar } from "..."` when mixing. Required so `tsc` (no bundler in `apps/api`) does not emit phantom runtime imports.
16. Never import from another workspace's internal paths (e.g. `@medbridge/contracts/src/...`). Import only from the published entry of `packages/contracts`.
17. Never use namespace imports (`import * as X`) for barrels; name what you use. Reserved for clearly namespaced APIs (e.g. `import * as path from "node:path"`).
18. Order imports: (a) `node:` built-ins, (b) external packages, (c) workspace packages (`@medbridge/*`), (d) relative parents (`../`), (e) relative siblings (`./`). One blank line between groups.

### Errors and async

19. Throw `Error` subclasses, never strings or plain objects. Catch typed: `catch (e) { if (e instanceof FooError) ... }`. Never type a `catch` parameter as anything other than `unknown` (the default).
20. Mark every function that does I/O or awaits as `async`. Never return a `Promise<T>` from a non-`async` function unless wrapping a library that already returns one.
21. Never leave a floating promise. Either `await` it, `void` it explicitly with a comment, or hand it to a tracked handler.

## Format / Template

Branded-type idiom (see `references/branded-types.md` for variants):

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type PatientId = Brand<string, "PatientId">;
export const PatientId = (s: string): PatientId => s as PatientId; // sole construction site
```

Discriminated-union skeleton:

```ts
export type Result<T, E> =
  | { kind: "ok"; value: T }
  | { kind: "err"; error: E };
```

## Examples

### CORRECT

```ts
// apps/api/src/patient/find.ts
import type { PatientId, Patient } from "@medbridge/contracts";

import { db } from "../db.js";

export async function findPatient(id: PatientId): Promise<Patient | null> {
  const rows = await db.query<Patient>("select * from patient where id = $1", [id]);
  const first = rows[0]; // Patient | undefined under noUncheckedIndexedAccess
  return first ?? null;
}

type Event =
  | { kind: "created"; at: Date }
  | { kind: "archived"; at: Date; reason: string };

function describe(e: Event): string {
  switch (e.kind) {
    case "created":  return `created ${e.at.toISOString()}`;
    case "archived": return `archived ${e.at.toISOString()}: ${e.reason}`;
    default: {
      const _exhaustive: never = e;
      throw new Error(`unreachable: ${String(_exhaustive)}`);
    }
  }
}

const ROUTES = {
  patient: "/api/patient",
  visit:   "/api/visit",
} as const satisfies Record<string, `/api/${string}`>;
```

### INCORRECT

```ts
// 1. violates Rule 1 (no any), Rule 4 (missing return type), Rule 15 (runtime import of a type)
import { Patient } from "@medbridge/contracts";
export async function findPatient(id: any) {
  const rows: any = await db.query("select * from patient where id = $1", [id]);
  return rows[0]!;                         // violates Rule 2 (non-null assertion) and Rule 7 (assumed defined)
}

// 2. violates Rule 11 (variant modeled with optional fields instead of a tag)
type Event = { created?: Date; archived?: Date; reason?: string };

// 3. violates Rule 14 (no exhaustiveness check; silently broken when a kind is added)
function describe(e: Event2): string {
  if (e.kind === "created")  return "c";
  if (e.kind === "archived") return "a";
  return "?";
}

// 4. violates Rule 12 (`: T` widens the literal so `ROUTES.patient` becomes `string`)
const ROUTES: Record<string, string> = { patient: "/api/patient" };

// 5. violates Rule 8 (`a: undefined` is rejected under exactOptionalPropertyTypes)
type Opt = { a?: string };
const x: Opt = { a: undefined };
```

## References

- `references/branded-types.md` — brand idioms (symbol vs string, smart constructors, zod integration).
- `references/discriminated-unions.md` — tagged-union design, narrowing patterns, exhaustiveness helpers.
- `references/satisfies-and-as-const.md` — when to use `satisfies`, `as const`, and the combination; widening pitfalls.
- `references/strict-mode-ergonomics.md` — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` recipes.
- `references/tsconfig-and-build.md` — `apps/api` vs `apps/ui` vs `packages/contracts` build expectations.

## Glossary

- **Branded type**: a structurally-distinct nominal type implemented by intersecting a base type with a unique tag.
- **Discriminated union**: a union of object types sharing a literal-typed tag field (`kind`, `type`, `_t`) used for narrowing.
- **`satisfies`**: post-fix operator that type-checks a value against a constraint without widening its inferred type.
- **Exact optional property types**: under `exactOptionalPropertyTypes: true`, `a?: T` and `a?: T | undefined` are distinct types.
