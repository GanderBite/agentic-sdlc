# Zod errors → AppError envelope

How a `safeParse` failure becomes a uniform JSON error response. Anchored on architecture §5 (the `AppError` taxonomy and `errorHandler` middleware).

## The on-the-wire shape

Every API error — validation, auth, not-found, conflict — emits:

```json
{
  "error": {
    "code":    "validation_failed",
    "message": "Request body failed validation.",
    "details": {
      "formErrors":  [],
      "fieldErrors": {
        "slotId":  ["Required", "Invalid uuid"],
        "reason":  ["String must contain at least 1 character(s)"]
      }
    }
  }
}
```

`details` is OPTIONAL on the envelope but ALWAYS present for `validation_failed`.

## AppError.validation

```ts
// apps/api/src/shared/errors.ts (shape only — actual impl owned by api code)
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code:   string,
    message:         string,
    readonly details?: unknown,
  ) { super(message); }

  static validation(flat: { formErrors: string[]; fieldErrors: Record<string, string[]> }) {
    return new AppError(422, "validation_failed", "Request body failed validation.", flat);
  }
}
```

`result.error.flatten()` returns exactly `{ formErrors, fieldErrors }`, so the mapping is:

```ts
const parsed = schema.safeParse(input);
if (!parsed.success) throw AppError.validation(parsed.error.flatten());
```

## HTTP status policy

| Boundary                   | Failure mode                          | Status | code                 |
|----------------------------|---------------------------------------|--------|----------------------|
| Request body / params      | `safeParse` failure                   | 422    | `validation_failed`  |
| Query-string parsing       | `safeParse` failure on coerced shape  | 422    | `validation_failed`  |
| Response serialization     | `parse` failure (server bug)          | 500    | `internal_error`     |

Use 422 (Unprocessable Entity), not 400, for schema validation failures. 400 is reserved for malformed requests the framework rejects before our middleware runs (e.g. invalid JSON).

## Hono middleware composition

```ts
import type { ErrorHandler } from "hono";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  c.get("logger").error({ err }, "unhandled");
  return c.json({ error: { code: "internal_error", message: "Internal server error." } }, 500);
};

app.onError(errorHandler);
```

A `ZodError` bubbling up directly is a BUG. Routes must catch the `safeParse` failure and wrap it in `AppError.validation` — never `app.onError` it via a `ZodError` instanceof check. The Zod failure path is internal to the route layer; the wire format is `AppError`.

## UI handling of 422

```ts
// apps/ui/src/api/parse-api-error.ts
import { errorEnvelope } from "@medbridge/contracts";

export async function parseApiError(res: Response): Promise<ApiError> {
  const envelope = errorEnvelope.parse(await res.json());
  return new ApiError(res.status, envelope.error);
}

// In a form component:
try {
  await apiClient.bookAppointment(data);
} catch (e) {
  if (e instanceof ApiError && e.error.code === "validation_failed") {
    const fields = e.error.details?.fieldErrors ?? {};
    for (const [name, msgs] of Object.entries(fields)) {
      form.setError(name as FieldPath<BookAppointmentRequest>, { message: msgs.join(", ") });
    }
    return;
  }
  toast.error("Unexpected error");
}
```

The shared `errorEnvelope` Zod schema lives in `packages/contracts/src/common/errors.ts`:

```ts
export const errorEnvelope = z.object({
  error: z.object({
    code:    z.string(),
    message: z.string(),
    details: z.object({
      formErrors:  z.array(z.string()),
      fieldErrors: z.record(z.string(), z.array(z.string())),
    }).optional(),
  }),
});
```

That schema is itself a contract — the UI relies on it to surface field errors back onto the right react-hook-form input. Changes to the envelope shape are MAJOR bumps.

## Mapping flattened errors back to form paths

`flatten()` keys are the top-level field names from the schema. Nested schemas need `format()`:

```ts
// Nested fieldErrors require .format()
const tree = parsed.error.format();
// tree.address?.street?._errors  →  string[]
```

If a request schema has nested objects (`address.street`), prefer `format()` server-side and translate to dotted paths before sending:

```ts
function flattenTree(tree: any, prefix = ""): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (k === "_errors") {
      if ((v as string[]).length && prefix) out[prefix] = v as string[];
      continue;
    }
    Object.assign(out, flattenTree(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}
```

react-hook-form supports dotted paths in `form.setError("address.street", ...)`, so the dotted convention round-trips cleanly.

## What can go wrong

| Failure mode                                      | Symptom                                       | Recovery                                                       |
|---------------------------------------------------|-----------------------------------------------|----------------------------------------------------------------|
| Route uses `parse` instead of `safeParse`         | 500 with stack-trace `ZodError`               | Replace with `safeParse` + `throw AppError.validation(...)`.   |
| Response schema is `.strict()` and server adds a field | Production 500 on every response of that op | Make response schemas non-strict (Rule 10).                    |
| UI uses a stale `BookAppointmentRequest` type     | Compile-time error in CI after bump           | `pnpm -r build` shows the broken consumer; update the caller.  |
| `errorEnvelope.parse` fails in the UI             | Generic toast, no field-level errors          | Server is emitting a non-envelope error — fix the server path. |
