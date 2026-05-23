# `satisfies`, `as const`, and the combination

These three forms look similar but produce different inferred types. Pick the one that matches intent.

## `: T` — type annotation (widens)

```ts
const COLORS: Record<string, string> = { red: "#f00", green: "#0f0" };
// type of COLORS.red is `string | undefined` (noUncheckedIndexedAccess) — and you can no
// longer reach for the literal "#f00" at compile time.
```

Use when you want the variable to be assignable to a broader type and you do not need to remember its narrow shape.

## `satisfies T` — type-check without widening

```ts
const COLORS = {
  red: "#f00",
  green: "#0f0",
} satisfies Record<string, string>;

// type of COLORS is { red: string; green: string }
// COLORS.red is string (defined), COLORS.blue is a TYPE ERROR (key not in literal type)
```

Use when you want both:

- Compile-time validation that the literal conforms to a constraint, AND
- Preservation of the literal's narrow shape for downstream inference.

## `as const` — freeze the literal

```ts
const COLORS = { red: "#f00", green: "#0f0" } as const;
// type: { readonly red: "#f00"; readonly green: "#0f0" }
```

Use when the literal values themselves must remain in the type (route tables, error codes, enum-like maps).

## Combining

```ts
const ROUTES = {
  patient: "/api/patient",
  visit:   "/api/visit",
} as const satisfies Record<string, `/api/${string}`>;
// type: { readonly patient: "/api/patient"; readonly visit: "/api/visit" }
// AND it is enforced that every value matches `/api/${string}`.
```

Order matters: `as const` first (to lock literals), then `satisfies` (to validate).

## Decision table

| Need                                                | Use                       |
|-----------------------------------------------------|---------------------------|
| Variable should be assignable to a broader type     | `: T`                     |
| Validate shape but keep narrow inference            | `satisfies T`             |
| Freeze the literal values in the type               | `as const`                |
| Freeze literals AND validate against a constraint   | `as const satisfies T`    |

## Common pitfalls

- `satisfies` cannot replace a return-type annotation on an exported function (Rule 4). Use both: explicit `: T` and an internal `satisfies` if you also want literal preservation in a closure.
- `as const` on a function argument does not flow back to widen the parameter — annotate the parameter with the literal type or a template literal.
- `enum` is a separate axis. Prefer `as const` objects + a derived union: `type Color = (typeof COLORS)[keyof typeof COLORS]` over `enum`.
