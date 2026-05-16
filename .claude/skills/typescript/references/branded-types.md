# Branded types

Branded (nominal) types let TypeScript distinguish two values that are structurally identical (e.g. a `PatientId` and a `VisitId` are both strings but must not be interchanged).

## Symbol-brand idiom (preferred)

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };
```

Why `unique symbol` and not a string-keyed phantom property:

- The brand key is uninhabitable at runtime — no one can construct it accidentally.
- It does not appear in `keyof T`, `JSON.stringify`, or object-iteration tools.
- `unique symbol` + `declare const` guarantees the symbol has no runtime identity (compiles to nothing).

## Concrete brands

```ts
export type PatientId = Brand<string, "PatientId">;
export type VisitId   = Brand<string, "VisitId">;
export type Cents     = Brand<number, "Cents">;
export type Iso8601   = Brand<string, "Iso8601">;
```

## Smart constructors

A brand without a validating constructor is theatre. Build a single construction site and a parser:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function PatientId(s: string): PatientId {
  if (!UUID_RE.test(s)) throw new Error(`invalid PatientId: ${s}`);
  return s as PatientId;
}

// Non-throwing variant for parse paths
export function tryPatientId(s: string): PatientId | null {
  return UUID_RE.test(s) ? (s as PatientId) : null;
}
```

Place all `as PatientId` casts inside the constructor. The brand is then enforced everywhere else by the type system.

## Zod integration

```ts
import { z } from "zod";

export const PatientIdSchema = z.string().uuid().transform((s) => s as PatientId);
export type PatientIdT = z.infer<typeof PatientIdSchema>;  // === PatientId
```

`transform` runs after validation, so the brand is applied only to validated values.

## What brands do not give you

- Brands are erased at runtime. A logging statement sees a plain `string`.
- Brands do not survive `JSON.parse`. Always re-parse with a schema at trust boundaries (HTTP, queue, DB).
- Brands do not block `as` casts performed by callers. Code review enforces "no manual `as PatientId`".

## Cross-workspace usage

Export brands from `packages/contracts` so `apps/api` and `apps/ui` reference the same type. Never redeclare a brand per workspace — TypeScript sees two distinct types (the `unique symbol` is module-scoped).
