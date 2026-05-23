<!-- version: 1.0.0 -->

# zod

## Purpose

Authoring rules for Zod v4 schemas in `packages/contracts` — one schema per RPC operation (request + response), shared by `apps/api` (server-side `safeParse` at request boundaries) and `apps/ui` (`@hookform/resolvers/zod` with react-hook-form).

## Consumers

- `builder` — writes Zod schemas in `packages/contracts/src/**` and consumes them from `apps/api/src/modules/*/routes.ts` and `apps/ui/src/**`.
- `reviewer` — verifies schema authoring and boundary-validation patterns.
- `tester` — references the same schemas in integration-test assertions.

## Rules

### File layout & exports

1. Place every contract schema under `packages/contracts/src/`. Never define request/response schemas inside `apps/api` or `apps/ui`.
2. Export both the schema and its inferred type from the same file. Name the schema `<operation>Request` / `<operation>Response`; name the type identically with a capitalized first letter, e.g. `BookAppointmentRequest`.
3. Derive types with `z.infer<typeof schema>`. Never hand-write a TypeScript `interface` that mirrors a schema.
4. Import schemas in apps via `@medbridge/contracts` (workspace `workspace:*`). Never deep-import from `packages/contracts/src/...`.

### Parsing & validation

5. Use `schema.safeParse(input)` at every request boundary in `apps/api`. Never use `schema.parse(input)` in route handlers, middleware, or service code that processes external input.
6. Use `schema.parse(input)` only in tests, seed scripts, or for compile-time-trusted constants where a throw is the correct failure mode.
7. On `safeParse` failure in a Hono route, throw `AppError.validation(result.error.flatten())` so the `errorHandler` middleware emits the uniform `{ error: { code, message, details? } }` shape (architecture §5).
8. Never silently swallow a `safeParse` failure with a default value. The contract is the source of truth.

### Schema construction

9. Use `z.object({...}).strict()` for every request schema. Reject unknown keys at the boundary.
10. Use `z.object({...})` (default `strip`) for response schemas so the server may add fields without breaking older clients.
11. Mark optional fields with `.optional()` for "may be omitted" and `.nullable()` for "may be present as null". Never conflate the two. Use `.nullish()` only when the wire format genuinely permits both.
12. Provide an explicit `.default(...)` only when the absence of the field has a deterministic server-side meaning. Never use `.default(...)` to paper over a missing client field.
13. Constrain every string with `.min(...)`, `.max(...)`, or `.regex(...)` unless it is structurally unbounded (e.g. free-text note). Constrain every number with `.int()`, `.min(...)`, `.max(...)` as applicable. Use `.uuid()` for UUIDs, `.email()` for emails, `.url()` for URLs, `.datetime({ offset: true })` for ISO-8601 timestamps.

### Branded IDs

14. Brand every domain identifier with `.brand<"...">()`. Example: `z.string().uuid().brand<"UserId">()`. Never pass raw `string` UUIDs across module boundaries.
15. Export the branded type from `packages/contracts` and reuse it everywhere. Never re-declare a brand in `apps/api` or `apps/ui`.

### Discriminated unions

16. Use `z.discriminatedUnion("kind", [...])` for any sum type with a literal tag. Never use `z.union([...])` over object schemas with a shared tag — the discriminated form gives O(1) parsing and better error messages.
17. Name the discriminator field `kind` (not `type`, `_type`, `tag`) for consistency across contracts.

### Refinements & transforms

18. Use `.refine(predicate, { message, path })` for cross-field invariants. Always supply `path` so the field error surfaces on the correct form input.
19. Use `.transform(...)` only for normalization that produces the SAME logical value (trim, lowercase, parseInt of a numeric string). Never use `.transform(...)` to change the semantic shape between request and response.
20. Never combine `.transform(...)` with a request schema whose inferred input type the UI relies on. The transformed (output) type diverges from the input type — use `z.input<typeof s>` for the UI and `z.output<typeof s>` for the server if both are needed.

### Sharing with the UI

21. Pair every form schema with `@hookform/resolvers/zod`: `useForm({ resolver: zodResolver(schema) })`. The same schema validates client-side (UX) and server-side (security).
22. Never duplicate validation logic between UI and API. If the rule cannot live in a Zod schema, isolate it in a single function inside `packages/contracts` and call it from both apps.

### Versioning & evolution

23. Bump `packages/contracts` version on every breaking schema change (added required field, removed field, narrowed enum). Never widen `.strict()` to `.passthrough()` to land a change — add the field to the schema instead.

## Schema template

```ts
// packages/contracts/src/appointments/book-appointment.ts
import { z } from "zod";

export const UserId   = z.string().uuid().brand<"UserId">();
export const SlotId   = z.string().uuid().brand<"SlotId">();
export type UserId = z.infer<typeof UserId>;
export type SlotId = z.infer<typeof SlotId>;

// REQUIRED: request — strict, brand IDs, explicit constraints.
export const bookAppointmentRequest = z.object({
  patientId: UserId,
  slotId:    SlotId,
  reason:    z.string().min(1).max(500),
  // OPTIONAL: omit-or-omit field — never .nullable() here.
  notes:     z.string().max(2000).optional(),
}).strict();

export type BookAppointmentRequest = z.infer<typeof bookAppointmentRequest>;

// REQUIRED: response — non-strict (forward-compatible).
export const bookAppointmentResponse = z.object({
  appointmentId: z.string().uuid().brand<"AppointmentId">(),
  status:        z.enum(["booked", "pending_confirmation"]),
  bookedAt:      z.string().datetime({ offset: true }),
});

export type BookAppointmentResponse = z.infer<typeof bookAppointmentResponse>;
```

Discriminated-union template:

```ts
export const documentEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("uploaded"),  documentId: z.string().uuid(), size: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("shared"),    documentId: z.string().uuid(), sharedWith: UserId }),
  z.object({ kind: z.literal("revoked"),   documentId: z.string().uuid(), revokedFrom: UserId }),
]);
```

Server boundary (Hono route):

```ts
// apps/api/src/modules/appointments/routes.ts
const parsed = bookAppointmentRequest.safeParse(await c.req.json());
if (!parsed.success) {
  throw AppError.validation(parsed.error.flatten());
}
const result = await service.bookAppointment(parsed.data);
return c.json(bookAppointmentResponse.parse(result), 201);
```

UI form binding:

```ts
// apps/ui/src/features/appointments/BookAppointmentForm.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { bookAppointmentRequest, type BookAppointmentRequest } from "@medbridge/contracts";

const form = useForm<BookAppointmentRequest>({
  resolver: zodResolver(bookAppointmentRequest),
});
```

## Examples

### CORRECT — request schema with brand, strict, and explicit constraints

```ts
export const createUserRequest = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(12).max(128),
  role:     z.enum(["patient", "doctor", "admin"]),
}).strict();

export type CreateUserRequest = z.infer<typeof createUserRequest>;
```

### CORRECT — server-side boundary validation

```ts
const parsed = createUserRequest.safeParse(body);
if (!parsed.success) throw AppError.validation(parsed.error.flatten());
const user = await userService.create(parsed.data);
```

### INCORRECT — uses `parse` on a request body

```ts
const data = createUserRequest.parse(await c.req.json()); // throws ZodError; bypasses AppError.
```

WHY: violates Rule 5 — server boundaries must use `safeParse` and map failures to `AppError.validation` so the error envelope stays uniform (architecture §5.2).

### INCORRECT — hand-written interface duplicating a schema

```ts
export const userResponse = z.object({ id: z.string().uuid(), email: z.string().email() });
export interface UserResponse { id: string; email: string; } // drift waiting to happen.
```

WHY: violates Rule 3 — derive the type with `z.infer<typeof userResponse>` so it cannot drift.

### INCORRECT — non-strict request lets unknown keys through

```ts
export const loginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
}); // missing .strict()
```

WHY: violates Rule 9 — request schemas must be `.strict()` to reject unknown keys at the boundary. (Response schemas remain non-strict, Rule 10.)

### INCORRECT — `z.union` over tagged objects

```ts
export const event = z.union([
  z.object({ kind: z.literal("a"), x: z.string() }),
  z.object({ kind: z.literal("b"), y: z.number() }),
]);
```

WHY: violates Rule 16 — use `z.discriminatedUnion("kind", [...])` for O(1) parsing and field-accurate errors.

## Deeper reference

- `references/v4-cheatsheet.md` — Zod v4 method index (objects, arrays, records, enums, refinements, transforms, coercion, recursive types) keyed to the rules above.
- `references/contracts-layout.md` — directory and naming conventions for `packages/contracts/src/`, request/response file shape, branded-ID re-export pattern, versioning policy.
- `references/error-mapping.md` — the `AppError.validation` payload shape, mapping `result.error.flatten()` to the uniform `{ error: { code, message, details } }` envelope, UI handling of 422 field errors.
