# AppError envelope assertions

MedBridge's API returns errors as a uniform JSON envelope (`docs/ARCHITECTURE.md §5.2`). Security smokes assert against the envelope, not against free-form messages.

## Envelope shape

```ts
type AppErrorBody = {
  error: {
    code: string;          // taxonomy enum, see table below
    message: string;       // user-facing, may be reworded; ≤200 chars
    details?: unknown;     // OPTIONAL: per-code structured payload
    request_id: string;    // correlates with server logs
  };
};
```

## Taxonomy — codes used by security smokes

| HTTP | code                    | When                                            |
|------|-------------------------|-------------------------------------------------|
| 401  | `AUTH_MISSING_TOKEN`    | No `Authorization` header.                      |
| 401  | `AUTH_INVALID_TOKEN`    | JWT expired, forged, wrong-kid, wrong-alg, malformed. |
| 403  | `CSRF_INVALID`          | Missing or mismatched CSRF double-submit.       |
| 403  | `FORBIDDEN`             | RBAC role lacks permission for the route.       |
| 403  | `SHARE_INVALID`         | Document share is revoked / expired / wrong viewer / wrong document. |
| 413  | `UPLOAD_TOO_LARGE`      | Body length exceeds `MAX_UPLOAD_BYTES`.         |
| 415  | `UPLOAD_MIME_MISMATCH`  | Declared `Content-Type` disagrees with magic bytes. |
| 400  | `UPLOAD_BAD_FILENAME`   | Filename has path separators, NUL, or fails the sanitization regex. |
| 429  | `RATE_LIMITED`          | Per-IP or per-account throttle hit.             |

Codes are stable. Messages are not.

## `assertAppError` helper

```ts
// apps/api/src/test/security/envelope.ts
import { expect } from "vitest";

const LEAK_PATTERNS: RegExp[] = [
  /\bSELECT\s+.+\bFROM\b/i,    // SQL fragment
  /\bat\s+\S+\s+\(.+:\d+:\d+\)/, // stack frame
  /\/(?:home|Users|var|etc|root)\//, // absolute filesystem path
  /\$2[aby]\$/,                // bcrypt hash
  /\$argon2/,                  // argon2 hash
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT-ish
];

export async function assertAppError(
  res: Response,
  expectedCode: string,
) {
  expect(res.headers.get("content-type")).toMatch(/application\/json/);
  const body = await res.json() as { error?: { code?: string; message?: string; request_id?: string } };
  expect(body.error?.code).toBe(expectedCode);
  expect(typeof body.error?.message).toBe("string");
  expect(body.error!.message.length).toBeGreaterThan(0);
  expect(body.error!.message.length).toBeLessThanOrEqual(200);
  for (const re of LEAK_PATTERNS) {
    expect(body.error!.message).not.toMatch(re);
  }
  expect(body.error?.request_id).toMatch(/^[A-Za-z0-9_-]{8,}$/);
}
```

## What to assert and what NOT to assert

DO assert:

- HTTP status code (exact).
- `error.code` (exact, from taxonomy).
- `error.message` shape: non-empty, ≤200 chars, matches no leak regex.
- `error.request_id` is present and well-formed.
- `Content-Type: application/json`.

DO NOT assert:

- `error.message` content equality. Copy will drift; tests will rot.
- Log lines. Logs are observability, not contract.
- Internal stack traces. They MUST not appear in the envelope; the leak regex covers that, you do not need a second assertion.

## Leak-detection rationale

The regex set catches the four real leaks we have hit historically:

1. `pg` driver errors echoed into messages (`SELECT * FROM users…`).
2. Node stack frames serialized via `err.toString()` instead of `err.message`.
3. File paths from `fs` errors (`/var/lib/medbridge/...`).
4. Hash material from misrouted password-reset failures.

If a future leak class appears, add it to `LEAK_PATTERNS` and re-run `pnpm -r test`.
