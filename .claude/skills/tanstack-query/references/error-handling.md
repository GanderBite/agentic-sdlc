# Error handling

## AppError shape (server contract)

The API returns errors with a consistent JSON envelope:

```ts
type AppErrorJson = {
  code: string;             // e.g. 'auth.invalid_credentials', 'validation.failed', 'patient.not_found'
  message: string;          // human-safe summary; never leaks internals
  details?: unknown;        // optional structured payload (e.g. Zod field errors)
};
```

HTTP status semantics:

| Status range | Meaning                       | Retry? |
|--------------|-------------------------------|--------|
| 400-499      | Client error (auth, validation, not-found, forbidden) | **No** |
| 500-599      | Server error                  | Yes, ≤1 |
| network      | Fetch threw / connection lost | Yes, ≤1 |

## Fetch wrapper → typed AppError

The wrapper under `apps/ui/src/api/` rejects with an `AppError` instance, not a raw `Response`:

```ts
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, body: AppErrorJson) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}
```

`useQuery`/`useSuspenseQuery`/`useMutation` callbacks receive this typed error.

## Retry policy

Default `QueryClient`:

```ts
retry: (failureCount, error) => {
  if (error instanceof AppError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}
```

- 4xx → never retry; the request is logically wrong, retrying won't fix it.
- 5xx or network → at most one retry. Beyond that, surface the error.
- Mutations: `retry: false` globally. Never silently re-charge / re-create on flaky network.

## Where errors surface

| Source                     | Surface                                     |
|----------------------------|---------------------------------------------|
| `useSuspenseQuery` throws  | Nearest `errorComponent` (Route) or boundary |
| `useQuery` w/ `isError`    | Inline rendering in the component           |
| `useMutation` `onError`    | Toast or inline form error                  |

## Toast vs inline

- **Toast** for fire-and-forget mutation errors (e.g. retry archive: "Failed to archive patient. Try again.").
- **Inline form errors** for validation failures (`AppError.code === 'validation.failed'` + `details` is a field-error map). Set them on the `react-hook-form` instance via `setError`.

```tsx
const create = useMutation({
  mutationFn: (input: CreatePatientInput) => api.patients.create(input),
  onError: (err) => {
    if (err instanceof AppError && err.code === 'validation.failed' && isFieldErrors(err.details)) {
      for (const [field, msg] of Object.entries(err.details)) {
        form.setError(field as keyof CreatePatientInput, { message: msg });
      }
      return;
    }
    toast.error(err.message);
  },
});
```

## Error boundaries

TanStack Router's `errorComponent` is the default catch:

```tsx
errorComponent: ({ error, reset }) => {
  if (error instanceof AppError && error.status === 404) return <NotFound />;
  if (error instanceof AppError && error.status === 403) return <Forbidden />;
  return <GenericError onReset={reset} />;
}
```

For sub-route regions, wrap in a hand-rolled boundary or `react-error-boundary`. Reset via `reset()` (the boundary handle) and `queryClient.resetQueries({ queryKey })` together to force a fresh attempt.

## CSRF, 401, and refresh

The fetch wrapper transparently:
1. Sends the JWT session cookie automatically (browser does this).
2. Reads `X-CSRF-Token` from the matching cookie and sends it on mutating verbs.
3. On `401`, runs the refresh flow once, then retries the original request. If refresh fails, throws `AppError(401, 'auth.session_expired')`.

Query/mutation callbacks observe only the FINAL outcome — the refresh handshake is invisible to them. On `auth.session_expired`, an app-level subscriber redirects to `/login`.

## Common pitfalls

- Calling `.catch()` on the promise inside a render function — swallows the error, breaks the boundary contract. The promise is thrown by `use`/`useSuspenseQuery` precisely so the boundary catches it.
- Treating `AppError.message` as i18n source. It is a fallback English string. UI-displayable copy keys off `AppError.code`.
- Retrying mutations. The default `mutations.retry: false` is correct; do not override unless the mutation is provably idempotent (e.g. `PUT` with the same payload).
