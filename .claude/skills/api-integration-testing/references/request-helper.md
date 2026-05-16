# request-helper.md — cookie jar + CSRF + JWT wiring

## API

```ts
import type { Hono } from 'hono';

type Role = 'patient' | 'doctor';
type AsValue = Role | 'patient-expired' | null;
type CsrfMode = 'auto' | 'omit' | 'mismatch';

export interface TestRequest {
  get(path: string, opts?: { as?: AsValue }): Promise<TestResponse>;
  post(path: string, opts?: { as?: AsValue; body?: unknown; csrf?: CsrfMode }): Promise<TestResponse>;
  put(path: string, opts?: { as?: AsValue; body?: unknown; csrf?: CsrfMode }): Promise<TestResponse>;
  delete(path: string, opts?: { as?: AsValue; csrf?: CsrfMode }): Promise<TestResponse>;
  reset(): void;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: any;
}

export function makeRequest(app: Hono): TestRequest;
```

## Internals

The helper holds a `Map<string, string>` cookie jar keyed by cookie name. On each call it:

1. Resolves `as` → a `UserAccount` row from the most recent `seed()` (looked up by role) and mints/refreshes the JWT cookie.
2. For state-changing verbs, ensures a `csrf_token` cookie exists in the jar (mints one if not), copies its value to the `X-CSRF-Token` header.
3. Serializes the jar into a single `Cookie:` request header.
4. Issues `app.fetch(new Request(absoluteUrl, init))` where `absoluteUrl` uses a non-http scheme (Hono ignores host).
5. Parses `Set-Cookie` response headers back into the jar, so chained calls in the same `it` see a consistent session.
6. Returns `{ status, headers, body }` with `body` always JSON-parsed when `content-type: application/json` (otherwise the raw text).

## JWT minting with `jose`

The helper uses the same secret the app reads. In tests, `JWT_SECRET` is set in the per-file env to a fixed string:

```ts
import { SignJWT } from 'jose';

const secret = new TextEncoder().encode(process.env.JWT_SECRET!); // set per-file

async function mintAccessJwt(user: UserAccount, opts?: { expSeconds?: number }) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({ role: user.role, orgId: user.orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + (opts?.expSeconds ?? 15 * 60))
    .sign(secret);
}
```

The claim shape (`sub`, `role`, `orgId`, `iat`, `exp`) must match exactly what `authRequired` middleware reads — see `apps/api/src/middleware/auth.ts`. Any drift in claim names → 401 from the wrong code path.

## Roles to user lookup

`makeRequest(app)` receives the `seed()` context lazily — the helper exposes `setCtx(ctx)` called from `beforeEach` right after `seed()`. The `as:` lookup is simply `ctx[as]`. There is no DB round-trip on every call.

`as: 'patient-expired'` mints a JWT with `exp` already in the past. Useful for testing token-expiry rejection.

`as: null` skips JWT minting AND clears the auth cookies — used for unauthenticated tests.

## CSRF modes

| `csrf` value | Behavior |
|---|---|
| `'auto'` (default) | Helper mints `csrf_token` cookie if absent, sets matching `X-CSRF-Token` header. |
| `'omit'` | Cookie is set, header is NOT sent. Tests CSRF middleware's missing-header path. |
| `'mismatch'` | Cookie is set, header sent with a different value. Tests constant-time-compare rejection. |

GETs ignore the `csrf` option entirely — the CSRF middleware doesn't run on safe verbs.

## Cookie names

Must match the app exactly:

- `session` — HttpOnly access JWT (15-min).
- `refresh` — HttpOnly refresh token (7-day).
- `csrf_token` — non-HttpOnly, readable by the SPA.

## Why not `supertest` / `pactum` / a real HTTP client

Hono runs on Node via `@hono/node-server` in production, but in tests we invoke `app.fetch(Request)` directly — no socket, no port. This is 5–10x faster per request than booting a real HTTP listener and matches how Hono's own test guidance works. The helper exists to keep `app.fetch` calls uniform, not because Hono needs an HTTP client.

## Reset semantics

`request.reset()` clears the cookie jar, drops the cached JWT-per-role map, and unsets `setCtx`. It does NOT re-call `seed()` — that's the test's responsibility. Tests that share a `seed()` call across multiple `it`s in one `describe` (rare) skip `reset()`, but this is discouraged because it breaks the "each `it` is independent" rule.

## Multipart uploads

For `documents.upload` and similar routes:

```ts
const form = new FormData();
form.append('file', new Blob([buf], { type: 'application/pdf' }), 'note.pdf');
const res = await request.post('/api/documents.upload', { as: 'patient', body: form });
```

The helper auto-detects `FormData` vs plain object and skips JSON serialization. CSRF still applies — set `X-CSRF-Token` header as usual, never embed the token in the form.
