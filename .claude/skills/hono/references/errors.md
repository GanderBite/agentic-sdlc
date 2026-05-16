# errors

Uniform error responses, `AppError` taxonomy, and the root `onError` handler. Aligns with `docs/ARCHITECTURE.md §5.2`.

## Error JSON shape (fixed)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request payload failed validation",
    "details": { "issues": [/* ... */] },
    "requestId": "0e6b...c4"
  }
}
```

Every error response — thrown `AppError`, Zod failure, 404, 500 — uses this shape.

## AppError taxonomy

| code                      | httpStatus | notes                                                 |
|---------------------------|------------|-------------------------------------------------------|
| `VALIDATION_ERROR`        | 400        | Zod failure; `details.issues` is required.            |
| `UNAUTHORIZED`            | 401        | Missing/invalid access token.                         |
| `CSRF_INVALID`            | 403        | Double-submit mismatch.                               |
| `FORBIDDEN`               | 403        | Authn ok, authz denied.                               |
| `NOT_FOUND`               | 404        | Resource lookup miss or unmounted path.               |
| `CONFLICT`                | 409        | Optimistic lock / unique constraint.                  |
| `UNSUPPORTED_MEDIA_TYPE`  | 415        | Disallowed upload MIME.                               |
| `FILE_TOO_LARGE`          | 413        | Upload exceeds byte ceiling.                          |
| `RATE_LIMITED`            | 429        | Throttled.                                            |
| `INTERNAL_ERROR`          | 500        | Catch-all; details omitted in prod.                   |

## errorHandler

```ts
// src/middleware/error.ts
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../errors';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId');
  const log = c.get('log');

  if (err instanceof AppError) {
    log.warn({ code: err.code, details: err.details }, 'app.error');
    return c.json(
      { error: { code: err.code, message: err.message, details: err.details, requestId } },
      err.httpStatus,
    );
  }

  if (err instanceof HTTPException) {
    log.warn({ status: err.status }, 'http.exception');
    return c.json(
      { error: { code: 'HTTP_EXCEPTION', message: err.message, requestId } },
      err.status,
    );
  }

  log.error({ err: { message: err.message, stack: err.stack } }, 'unhandled.error');
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', requestId } },
    500,
  );
};
```

## notFound helper

```ts
// src/errors.ts (excerpt)
export const notFoundError = (c: Context) => ({
  error: {
    code: 'NOT_FOUND',
    message: `Route ${c.req.method} ${c.req.path} not found`,
    requestId: c.get('requestId'),
  },
});
```

Used as: `app.notFound((c) => c.json(notFoundError(c), 404));`

## Never do

- Return `c.text(...)` for errors. Always JSON.
- Leak stack traces into `details` in production. Stack is logged, never serialized.
- Catch errors inside handlers just to re-shape them. Throw `AppError` and let `onError` shape it.
