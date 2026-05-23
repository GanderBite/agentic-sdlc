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

## Module-system convention (load-bearing — TS5097)

This repo compiles with `tsc` (no bundler) and the workspace `tsconfig.json` resolves modules under **NodeNext**. Under NodeNext, relative imports MUST carry an explicit file extension, and that extension MUST be the **output** extension (`.js`), NEVER the source extension (`.ts` / `.tsx`). The compiler errors with TS5097 if a relative `import … from "./foo.ts"` appears in a `.ts` source file.

Examples (all in `apps/api/src/**` or `packages/contracts/src/**`):

```ts
// CORRECT — relative imports use the OUTPUT extension `.js`
import { findUserById } from "./repo.js";
import type { User } from "./schema.js";
import { sql } from "drizzle-orm";              // bare specifier: no extension

// INCORRECT — TS5097 under NodeNext (this is the recurring drift from sprint-001)
import { findUserById } from "./repo.ts";       // wrong extension
import { findUserById } from "./repo";          // missing extension
import { findUserById } from "./repo.tsx";      // wrong extension
```

Bare specifiers (`drizzle-orm`, `@medbridge/contracts`, `node:path`) never take an extension. The rule applies to relative (`./`, `../`) and absolute-from-root (`/`) imports only.

## Builder protocol

Contract per `verification-gates §R6`. Runs **after edits, before `task.verification`**. Idempotent, scoped to `${TARGET_FILES}`. Catches the TS5097 drift before the gate audits it.

```sh
# Reject any relative import whose specifier ends in .ts/.tsx — these
# would fail TS5097 under NodeNext. Scope: files this task touched.
if [ -n "${TARGET_FILES}" ]; then
  ts_files=$(printf '%s\n' ${TARGET_FILES} | grep -E '\.(ts|tsx)$' || true)
  if [ -n "${ts_files}" ]; then
    if printf '%s\n' ${ts_files} | xargs -I{} rg --line-number --no-heading \
        "from\s+['\"](\.\.?\/[^'\"]+)\.(ts|tsx)['\"]" {} ; then
      echo "[typescript builder protocol] relative import uses source extension (.ts/.tsx); use .js per Module-system convention." >&2
      exit 1
    fi
  fi
fi
```

The check is a fail-fast detector, not an auto-fixer — the builder rewrites the import line itself (each match prints `<file>:<line>:<text>`), then re-runs the protocol until clean. A codemod is intentionally out of scope: the substitution is mechanical but the human-readable diff helps the builder catch deeper module-graph mistakes (e.g. importing from a not-yet-created file).

## Verification recipe

Gates the **planner** may append to any task whose `skills` include `typescript`. First token is `pnpm` (in `build-graph.json → tools`).

```json
{
  "build": [
    "pnpm --filter <package-that-owns-target-files> typecheck"
  ]
}
```

Recipe rules:
- **Scope MUST match the touched package(s).** Same derivation as `biome/Verification recipe` — workspace name whose directory is the longest prefix of any `target_files` path.
- A `typecheck` script in the package is expected (per the `pnpm` skill); if absent, the planner re-prompts rather than substituting `tsc --noEmit` (which lacks the workspace's `tsconfig.json` extends chain).
- Tasks whose `target_files` span multiple packages emit one `build` entry per package — never a `pnpm -r typecheck` for a package-scoped task.

## Common pitfalls

1. **TS5097: relative import uses `.ts` or `.tsx` source extension** (or omits the extension entirely). The single highest-recurrence drift in this repo's sprint history — see `sprint-planning/references/common-pitfalls.md`. FIX: see **Module-system convention** above; Builder protocol catches it before gates run.
2. **`as T` cast to silence the compiler** (Rule 3). Hides genuine type errors. FIX: refactor or narrow with a guard; the only allowed escape is `as unknown as T` with a justifying comment.
3. **Eager singletons that bypass DI seams** — `export const db = drizzle(...)` evaluated at module top-level; test code cannot substitute a fake. FIX: export a factory (`makeDb(pool)`) or a `getDb()` lazy accessor. See `references/strict-mode-ergonomics.md` and per-sprint `do-not-recur.md` digests.
4. **Untyped catch parameter** (Rule 19). `catch (e: any)` defeats Rule 1. FIX: leave the catch parameter implicit (`catch (e)` ⇒ `unknown`) and narrow with `instanceof`.
5. **Non-`async` function returning `Promise<T>`** (Rule 20). Breaks stack traces and confuses callers. FIX: mark the function `async` and `await` inside, or wrap with `async () => libCall()`.
6. **Floating promise** (Rule 21). FIX: `await`, `void`-prefix with a comment, or `.catch(handler)`.
