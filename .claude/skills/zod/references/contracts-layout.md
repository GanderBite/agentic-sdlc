# packages/contracts layout

Conventions for the shared schema package. Architecture §2.1, §4 establish that `packages/contracts` is the ONLY code shared between `apps/api` and `apps/ui`.

## Directory shape

```
packages/contracts/
  package.json
  tsconfig.json
  src/
    index.ts                       # barrel — re-exports every public schema/type
    common/
      ids.ts                       # branded ID types (UserId, AppointmentId, …)
      errors.ts                    # error-envelope schema (mirrors AppError on the wire)
      pagination.ts                # standard page/cursor params
    auth/
      login.ts                     # loginRequest, loginResponse
      refresh.ts
      logout.ts
    appointments/
      book-appointment.ts
      cancel-appointment.ts
      list-appointments.ts
    documents/
      upload-document.ts
      share-document.ts
    scheduling/
      list-slots.ts
```

One file per RPC operation (architecture §8 Q5 — the per-operation form is the default; revisit when feature count justifies aggregation).

## File shape (one operation)

```ts
// packages/contracts/src/appointments/book-appointment.ts
import { z } from "zod";
import { UserId, SlotId, AppointmentId } from "../common/ids.js";

// REQUEST -------------------------------------------------------------
export const bookAppointmentRequest = z.object({
  patientId: UserId,
  slotId:    SlotId,
  reason:    z.string().min(1).max(500),
  notes:     z.string().max(2000).optional(),
}).strict();

export type BookAppointmentRequest = z.infer<typeof bookAppointmentRequest>;

// RESPONSE ------------------------------------------------------------
export const bookAppointmentResponse = z.object({
  appointmentId: AppointmentId,
  status:        z.enum(["booked", "pending_confirmation"]),
  bookedAt:      z.string().datetime({ offset: true }),
});

export type BookAppointmentResponse = z.infer<typeof bookAppointmentResponse>;
```

## Barrel re-exports

```ts
// packages/contracts/src/index.ts
export * from "./common/ids.js";
export * from "./common/errors.js";
export * from "./common/pagination.js";
export * from "./auth/login.js";
export * from "./auth/refresh.js";
export * from "./appointments/book-appointment.js";
// …
```

Importers always reach through the barrel:

```ts
import { bookAppointmentRequest, type BookAppointmentRequest } from "@medbridge/contracts";
```

Never:

```ts
import { … } from "@medbridge/contracts/src/appointments/book-appointment"; // forbidden
```

## Naming rules

| Element                  | Convention                              | Example                       |
|--------------------------|-----------------------------------------|-------------------------------|
| Request schema (value)   | camelCase, `<operation>Request`         | `bookAppointmentRequest`      |
| Response schema (value)  | camelCase, `<operation>Response`        | `bookAppointmentResponse`     |
| Inferred type            | PascalCase, same stem                   | `BookAppointmentRequest`      |
| Branded ID value+type    | PascalCase (both)                       | `UserId`                      |
| Operation file           | kebab-case, verb-first                  | `book-appointment.ts`         |
| Module folder            | kebab-case, plural noun                 | `appointments/`               |

The `<operation>` stem must match the RPC name used by the typed UI client (architecture §3.1 — hand-written `fetch` wrapper).

## Branded IDs — single source of truth

```ts
// packages/contracts/src/common/ids.ts
import { z } from "zod";

export const UserId        = z.string().uuid().brand<"UserId">();
export const SlotId        = z.string().uuid().brand<"SlotId">();
export const AppointmentId = z.string().uuid().brand<"AppointmentId">();
export const DocumentId    = z.string().uuid().brand<"DocumentId">();
export const RefreshTokenId = z.string().uuid().brand<"RefreshTokenId">();

export type UserId         = z.infer<typeof UserId>;
export type SlotId         = z.infer<typeof SlotId>;
export type AppointmentId  = z.infer<typeof AppointmentId>;
export type DocumentId     = z.infer<typeof DocumentId>;
export type RefreshTokenId = z.infer<typeof RefreshTokenId>;
```

Never redeclare a brand in `apps/api` or `apps/ui`. Importing the brand from `@medbridge/contracts` is the property that prevents an `AppointmentId` from being assignable to a `UserId`-typed parameter.

## Versioning policy

`packages/contracts` is a workspace package (`workspace:*`). Even though there is no external publish, treat each schema change as a wire-format change:

| Change                                              | Severity   | Action                                                  |
|-----------------------------------------------------|------------|---------------------------------------------------------|
| Add OPTIONAL field to request                       | minor      | Bump `0.x.y` → `0.x.(y+1)`                              |
| Add field to response                               | minor      | Bump `0.x.y` → `0.x.(y+1)` (strip-mode tolerates it)    |
| Add REQUIRED field to request                       | BREAKING   | Bump major; update every caller in the same PR          |
| Remove field from response                          | BREAKING   | Bump major; update every consumer                       |
| Narrow enum, tighten regex, lower `.max`            | BREAKING   | Bump major                                              |
| Widen enum, raise `.max`                            | minor      | Bump minor                                              |
| Rename field                                        | BREAKING   | Bump major; never rename in place — add new, remove old |

Never reach for `.passthrough()` to land a change without bumping. The schema is the contract.

## Consuming from apps/api

```ts
import { bookAppointmentRequest, bookAppointmentResponse } from "@medbridge/contracts";

app.post("/api/appointments", async (c) => {
  const parsed = bookAppointmentRequest.safeParse(await c.req.json());
  if (!parsed.success) throw AppError.validation(parsed.error.flatten());

  const result = await appointmentService.book(parsed.data);

  // Serialize via response schema — strip extras, validate shape in dev.
  return c.json(bookAppointmentResponse.parse(result), 201);
});
```

`bookAppointmentResponse.parse(result)` on the way out is a defence-in-depth check: it guarantees the server never returns a shape the schema doesn't describe. In production builds the cost is negligible for our request volumes; if it becomes a hot path, narrow to `.parse` only in NODE_ENV=development.

## Consuming from apps/ui

```ts
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  bookAppointmentRequest,
  type BookAppointmentRequest,
} from "@medbridge/contracts";

export function BookAppointmentForm() {
  const form = useForm<BookAppointmentRequest>({
    resolver: zodResolver(bookAppointmentRequest),
    defaultValues: { reason: "", notes: undefined },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    // `data` is already validated by Zod via the resolver.
    await apiClient.bookAppointment(data);
  });

  return /* … react-hook-form bindings … */;
}
```

The typed `apiClient` (architecture §3) also uses the response schema:

```ts
async function bookAppointment(body: BookAppointmentRequest): Promise<BookAppointmentResponse> {
  const res = await fetch("/api/appointments", { method: "POST", body: JSON.stringify(body), ... });
  if (!res.ok) throw await parseApiError(res);
  return bookAppointmentResponse.parse(await res.json());
}
```
