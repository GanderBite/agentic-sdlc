<!-- version: 1.0.0 -->

# hono

## Purpose

Encodes idiomatic Hono 4 patterns for the MedBridge HTTP API: app composition, middleware order, Zod-validated routes, multipart via `c.req.parseBody`, uniform `AppError` responses, JWT + CSRF auth wiring, and `@hono/node-server` bootstrap.

## Consumers

- builder — implements routes, middleware, and the server entrypoint.
- reviewer — verifies middleware order, validation, error shape, and bootstrap conform to these rules.

## Stack pins

- `hono` `^4.6.x` — Node 25 runtime only. No Bun, no Deno, no edge adapters.
- `@hono/node-server` `^1.13.x` — sole bootstrap path.
- `zod` `^4.0.x` — imported from `packages/contracts` (never re-declared in route files).
- `jose` — JWT verify/sign (15-min access, 7-day server-side refresh).
- `pino` `^9.5.x` — structured JSON logger on stdout.
- Multipart: `c.req.parseBody({ all: true })`. Do not add `formidable`, `busboy`, or `multer`.

## Rules

### App composition

1. Construct exactly one root `Hono` instance in `src/app.ts` and export it as `app`. Bootstrap (`serve(...)`) lives in `src/server.ts`, never alongside route definitions.
2. Mount feature routers via `app.route('/v1/<resource>', resourceRouter)`. Each feature owns one `Hono` subapp in `src/routes/<resource>/index.ts`.
3. Type the app with the shared `Env` generic: `new Hono<{ Variables: AppVariables; Bindings: never }>()`. `AppVariables` is defined once in `src/types/hono.ts`.
4. Register middleware on the root app in this exact order, top to bottom: `requestId` → `logger` → `cors` → `secureHeaders` → `csrf` → `auth` (route-scoped) → route handlers → `onError`. See `references/middleware.md`.
5. Use `c.set('var', value)` / `c.get('var')` for per-request context (request id, user claims, db tx). Never attach to globals or to the `app` instance.

### Routing

6. Bind route handlers with explicit HTTP verb methods: `app.get`, `app.post`, `app.put`, `app.patch`, `app.delete`. Never use `app.all` except in catch-all 404.
7. Path params use `:name` syntax and are typed via `c.req.param('name')`. Never read `c.req.url` to parse params manually.
8. Register the 404 handler exactly once on the root app: `app.notFound((c) => c.json(notFoundError(c), 404))`.

### Validation (Zod)

9. Validate every request body, query, and path param with `@hono/zod-validator`'s `zValidator`, using schemas imported from `@medbridge/contracts`. Never call `schema.parse` inside handlers.
10. Use the validator hook to convert Zod failures into `AppError` with `code: 'VALIDATION_ERROR'`. See `references/validation.md` for the canonical wrapper.
11. Read validated data with `c.req.valid('json' | 'query' | 'param' | 'form')`. Never read raw `await c.req.json()` after a validator runs.

### Multipart / file uploads

12. Parse multipart bodies with `await c.req.parseBody({ all: true })`. Do not introduce additional multipart libraries.
13. Validate uploaded `File` entries against an explicit allow-list of MIME types and a hard byte ceiling before any I/O. Reject with `AppError('FILE_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE')`.
14. Stream large uploads to disk/object storage via `file.stream()`. Never call `file.arrayBuffer()` on uploads above 1 MiB.

### Error handling

15. Throw `AppError` (per `docs/ARCHITECTURE.md §5.2`) from handlers and middleware. Never throw bare `Error` or return ad-hoc `c.json({ error: ... })` shapes.
16. Register a single `app.onError(errorHandler)` on the root app. The handler maps `AppError` → typed JSON, `HTTPException` → its status, unknown → `500 INTERNAL_ERROR`. See `references/errors.md`.
17. The error JSON shape is fixed: `{ error: { code, message, details?, requestId } }`. `requestId` is read from `c.get('requestId')`.

### Auth (JWT + refresh + CSRF)

18. Verify the 15-minute access JWT via `jose.jwtVerify` inside an `authRequired` middleware. Attach claims with `c.set('user', claims)`. Reject with `AppError('UNAUTHORIZED')` on any verification failure.
19. Refresh tokens are server-side (DB-backed) and never live in JWTs. Rotate on every refresh. See `references/auth.md`.
20. For state-changing routes (`POST | PUT | PATCH | DELETE`), require CSRF double-submit: cookie `csrf` must equal header `x-csrf-token`. Reject with `AppError('CSRF_INVALID')`. GETs are exempt.
21. Set auth cookies with `setCookie(c, name, value, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })` from `hono/cookie`. The CSRF cookie is the only auth cookie with `httpOnly: false`.

### Logging

22. Use pino via `logger` middleware that creates a child logger per request with `{ requestId, method, path }` bindings and stores it on `c.set('log', child)`. Handlers log through `c.get('log')`, never through the root logger.
23. Log one `request.complete` line per request at `onError` and after successful response, with `status` and `durationMs`. Do not log request bodies.

### Bootstrap (`@hono/node-server`)

24. The sole bootstrap call is `serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => log.info(info, 'listening'))` in `src/server.ts`.
25. Register graceful shutdown: on `SIGTERM` / `SIGINT`, call the returned server's `close()` and `await` in-flight DB transactions before `process.exit(0)`.
26. Never call `app.fire()`, `Bun.serve`, or `Deno.serve`. Node adapter only.

## Schema — route module template

```ts
// src/routes/<resource>/index.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateResource } from '@medbridge/contracts/resource';   // REQUIRED: shared Zod schemas
import { authRequired } from '../../middleware/auth';
import { csrf } from '../../middleware/csrf';
import { AppError } from '../../errors';                          // REQUIRED: uniform errors
import type { AppVariables } from '../../types/hono';

const resource = new Hono<{ Variables: AppVariables }>();

resource.use('*', authRequired);                                  // REQUIRED: scope auth

resource.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.get('db').resource.findById(id);
  if (!row) throw new AppError('NOT_FOUND', `resource ${id} missing`);
  return c.json(row, 200);
});

resource.post(
  '/',
  csrf,                                                           // REQUIRED on POST
  zValidator('json', CreateResource, (result, c) => {             // REQUIRED validator hook
    if (!result.success) throw AppError.fromZod(result.error);
  }),
  async (c) => {
    const input = c.req.valid('json');                            // REQUIRED — typed
    const created = await c.get('db').resource.create(input);
    return c.json(created, 201);
  },
);

export default resource;
```

## Examples

### CORRECT — root app composition (`src/app.ts`)

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/error';
import { notFoundError } from './errors';
import resource from './routes/resource';
import auth from './routes/auth';
import type { AppVariables } from './types/hono';

export const app = new Hono<{ Variables: AppVariables }>();

app.use('*', requestId);                            // Rule 4: order matters
app.use('*', logger);
app.use('*', cors({ origin: CONFIG.allowedOrigins, credentials: true })); // import from src/config
app.use('*', secureHeaders());

app.route('/v1/auth', auth);                        // Rule 2
app.route('/v1/resource', resource);

app.notFound((c) => c.json(notFoundError(c), 404)); // Rule 8
app.onError(errorHandler);                          // Rule 16
```

### CORRECT — bootstrap (`src/server.ts`)

```ts
import { serve } from '@hono/node-server';
import { app } from './app';
import { log } from './logger';

const server = serve(
  { fetch: app.fetch, port: 3000, hostname: '0.0.0.0' },
  (info) => log.info({ port: info.port }, 'listening'),
);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log.info({ sig }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
```

### INCORRECT — handler that parses + validates inline

```ts
resource.post('/', async (c) => {
  const body = await c.req.json();                  // violates Rule 11
  const parsed = CreateResource.parse(body);        // violates Rule 9
  if (!parsed) return c.json({ error: 'bad' }, 400);// violates Rule 15, 17
  // ... CSRF missing on POST                       // violates Rule 20
});
```

WHY: Rule 9 (validators only), Rule 11 (read via `c.req.valid`), Rule 15 (use `AppError`), Rule 17 (fixed error shape), Rule 20 (CSRF required on POST).

### INCORRECT — bootstrap on the edge runtime

```ts
export default app;                                 // violates Rule 26
// or:
app.fire();                                         // violates Rule 26
```

WHY: This project runs on Node 25 via `@hono/node-server`. Rules 24 and 26 forbid alternative bootstraps.

## Deeper reference

- `references/middleware.md` — request-id, logger, CORS, secure-headers, CSRF order, examples.
- `references/validation.md` — `zValidator` wiring, hook signature, mapping `ZodError` → `AppError`.
- `references/errors.md` — `AppError` taxonomy, `errorHandler` implementation, HTTP-status mapping.
- `references/auth.md` — `authRequired` middleware, refresh-token rotation, cookie flags, CSRF double-submit.
- `references/multipart.md` — `parseBody` patterns, size limits, streaming to object storage.
- `references/bootstrap.md` — `@hono/node-server` options, graceful shutdown, healthcheck.

## Glossary

- **AppError** — project error class, see `docs/ARCHITECTURE.md §5.2`. Carries `code`, `message`, `httpStatus`, `details?`.
- **AppVariables** — typed `c.set/get` keys: `requestId`, `log`, `user`, `db`. Declared in `src/types/hono.ts`.
- **CSRF double-submit** — cookie `csrf` (not httpOnly) must equal header `x-csrf-token` on state-changing requests.

## Builder protocol

Contract per `verification-gates §R6`. Runs **after edits, before `task.verification`**. Idempotent.

```sh
# Reject bare Error throws and ad-hoc c.json({ error: ... }) in handlers — Rule 15.
if [ -n "${TARGET_FILES}" ]; then
  handler_files=$(printf '%s\n' ${TARGET_FILES} | grep -E '(routes|handlers|middleware)/.*\.ts$' || true)
  if [ -n "${handler_files}" ]; then
    if printf '%s\n' ${handler_files} | xargs rg --line-number --no-heading \
        "throw new Error\(|c\.json\(\s*\{\s*error:" 2>/dev/null; then
      echo "[hono builder protocol] handler throws bare Error or returns ad-hoc { error: ... }; use AppError (Rule 15)." >&2
      exit 1
    fi
  fi
fi
```

## Verification recipe

Gates the **planner** may append for route/middleware tasks.

```json
{
  "custom": [
    { "cmd": "rg --quiet '@hono/zod-validator' apps/api/src/routes", "expect_exit": 0 }
  ]
}
```

Recipe rules:
- A task that creates a new route file MUST verify the validator import appears (Rule 9). Planner adds a `custom` gate pinned to the specific file.
- The standard `tests` and `lint` gates come from `vitest` and `biome` recipes — hono does not duplicate them.

## Common pitfalls

1. **Throwing bare `Error` from a handler / middleware** (Rule 15). FIX: throw `AppError` with the typed code; Builder protocol detects it.
2. **Calling `schema.parse(...)` inside a handler** instead of `zValidator` (Rule 9). FIX: use `zValidator('json' | 'query' | 'param' | 'form', schema)` in the route binding.
3. **Hard-coded secret defaults like `"change-me"` in compose / env defaults** (this was a wave-7 deferred finding in sprint-001). FIX: refuse to start without the env var; tests provide a test-only secret via a fixture, never via a default. Cross-ref `docker-compose` skill.
4. **Middleware order violations** (Rule 4). FIX: `requestId → logger → cors → secureHeaders → csrf → auth → routes → onError`. Wave-reviewer rejects deviations.
5. **Reading `await c.req.json()` after a validator ran** (Rule 11). FIX: read validated data with `c.req.valid('json' | 'query' | 'param' | 'form')`.
