# middleware

Canonical middleware implementations and ordering for the MedBridge Hono app.

## Order (root app)

```
requestId → logger → cors → secureHeaders → csrf (route-scoped) → authRequired (route-scoped) → handler → onError
```

- `requestId` must run first so every downstream log line and error response carries `requestId`.
- `logger` must run before `cors`/`secureHeaders` so preflight rejections are also logged.
- `csrf` and `authRequired` are NOT global — they are mounted on the subapps that need them (anything except `GET /v1/health` and the auth-bootstrap routes).

## requestId

```ts
// src/middleware/request-id.ts
import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

export const requestId: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && /^[a-f0-9-]{8,64}$/i.test(incoming) ? incoming : randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
};
```

Notes:
- Trust an incoming header only if it matches a UUID-ish pattern; otherwise generate. This blocks header injection while preserving traces from the edge.
- Always echo `x-request-id` in the response so clients can correlate.

## logger (pino child per request)

```ts
// src/middleware/logger.ts
import type { MiddlewareHandler } from 'hono';
import { log as root } from '../logger';

export const logger: MiddlewareHandler = async (c, next) => {
  const start = process.hrtime.bigint();
  const child = root.child({
    requestId: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
  });
  c.set('log', child);
  try {
    await next();
  } finally {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    child.info(
      { status: c.res.status, durationMs: +durationMs.toFixed(1) },
      'request.complete',
    );
  }
};
```

Notes:
- Never log request bodies. They may contain PHI.
- Log even on thrown errors; the `finally` ensures one line per request.
- `c.res.status` is set by `onError` for thrown errors before `finally` runs.

## cors

```ts
import { cors } from 'hono/cors';

app.use(
  '*',
  cors({
    origin: ['https://app.medbridge.local'],
    credentials: true,                       // cookies are auth — required
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
    exposeHeaders: ['x-request-id'],
    maxAge: 600,
  }),
);
```

Never use `origin: '*'` — incompatible with `credentials: true` and forbidden by the auth model.

## secureHeaders

```ts
import { secureHeaders } from 'hono/secure-headers';

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: false,            // API responses are JSON; CSP is set by the web app
    referrerPolicy: 'no-referrer',
    crossOriginResourcePolicy: 'same-site',
  }),
);
```

## CSRF (double-submit)

See `auth.md` for the full implementation. Mount on every state-changing subapp:

```ts
import { csrf } from '../middleware/csrf';

resource.post('/', csrf, /* validator */, handler);
resource.patch('/:id', csrf, /* validator */, handler);
resource.delete('/:id', csrf, handler);
```

`GET`s never receive `csrf`.

## authRequired

See `auth.md`. Standard wiring:

```ts
resource.use('*', authRequired);             // entire subapp behind auth
```

For a single public route inside an authed subapp, scope per-route instead:

```ts
const sub = new Hono<{ Variables: AppVariables }>();
sub.get('/public', publicHandler);           // no authRequired
sub.use('/private/*', authRequired);
sub.get('/private/me', meHandler);
```
