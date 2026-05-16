# Discriminated unions

A discriminated union is a `|` of object types sharing one literal-typed tag field. The tag enables narrowing, exhaustiveness, and stable runtime serialization.

## Shape

```ts
export type LoadState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; error: Error };
```

Rules:

- The tag (`kind` / `type` / `_t`) must be a string literal, not an `enum`. String literals serialize predictably and are debuggable.
- The tag name is consistent project-wide. MedBridge uses `kind`.
- Each variant carries only the fields valid for that variant. No optional fields shared across variants — that defeats the purpose.

## Narrowing

```ts
function render<T>(s: LoadState<T>) {
  switch (s.kind) {
    case "idle":    return "—";
    case "loading": return "...";
    case "ready":   return JSON.stringify(s.data);
    case "error":   return s.error.message;
    default: {
      const _exhaustive: never = s;
      throw new Error(`unhandled: ${String(_exhaustive)}`);
    }
  }
}
```

The `never`-default trick is the only reliable way to fail compilation when a new variant is added.

## `assertNever` helper

For projects that pattern-match in many places:

```ts
export function assertNever(x: never, ctx?: string): never {
  throw new Error(`unreachable${ctx ? ` (${ctx})` : ""}: ${JSON.stringify(x)}`);
}

// usage
default: return assertNever(s, "render");
```

## Result and Option patterns

```ts
export type Result<T, E = Error> =
  | { kind: "ok"; value: T }
  | { kind: "err"; error: E };

export const ok  = <T>(value: T): Result<T, never> => ({ kind: "ok", value });
export const err = <E>(error: E): Result<never, E> => ({ kind: "err", error });
```

`Result` is preferred over throwing for predictable, expected failure modes (validation, parse, business-rule rejection). Throw for programmer errors and unexpected I/O failures.

## Anti-patterns

```ts
// BAD: union of optional fields (no tag, no exhaustiveness, ambiguous when all undefined)
type Event = { created?: Date; archived?: Date; reason?: string };

// BAD: boolean discriminant — only two variants and impossible to extend
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
// (`ok` boolean is acceptable for exactly-two-variant cases but reject any growth.)

// BAD: enum tag — works but harder to debug and serialize
enum Kind { Ok, Err }
type R<T> = { kind: Kind.Ok; v: T } | { kind: Kind.Err; e: Error };
```

## Working with `contracts` package

When a discriminated union crosses the workspace boundary (e.g. a wire-format event), prefer:

- Define the union in `packages/contracts`.
- Export a zod schema in the same package: `z.discriminatedUnion("kind", [...])`.
- Always re-validate at the boundary; never trust an inbound payload's narrowing.
