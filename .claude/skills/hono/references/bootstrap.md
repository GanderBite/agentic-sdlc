# bootstrap

`@hono/node-server` wiring, graceful shutdown, and healthcheck.

## `src/server.ts` (canonical)

```ts
import { serve, type ServerType } from '@hono/node-server';
import { app } from './app';
import { log } from './logger';
import { closeDb } from './db';

const PORT = Number(process.env.PORT ?? 3000);

const server: ServerType = serve(
  { fetch: app.fetch, port: PORT, hostname: '0.0.0.0' },
  (info) => log.info({ port: info.port, host: info.address }, 'listening'),
);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutdown.begin');

  // Stop accepting new connections.
  await new Promise<void>((resolve) => server.close(() => resolve()));

  // Drain DB pool, flush log buffer, etc.
  await closeDb();
  await new Promise<void>((resolve) => log.flush(() => resolve()));

  log.info('shutdown.complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Make unhandledRejection a hard fail in production.
process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'unhandledRejection');
  process.exit(1);
});
```

## Healthcheck

Mount before auth:

```ts
// src/app.ts (excerpt)
app.get('/v1/health', (c) =>
  c.json({ status: 'ok', requestId: c.get('requestId') }, 200),
);
```

This route is intentionally:
- Outside the auth subapp (`authRequired` not applied).
- Plain GET (no CSRF).
- Returns `requestId` so probes correlate with logs.

## Environment

`PORT` is the only port source. Do not hardcode 3000 outside `server.ts`. Read other config (`JWT_SECRET`, `DATABASE_URL`, etc.) in `src/config.ts` and import from there.

## Never do

- `app.fire()` — that targets the Service Worker / edge runtime. Project is Node-only.
- `Bun.serve` / `Deno.serve` — forbidden adapters.
- `process.exit(0)` before `server.close` resolves — drops in-flight requests.
- Listen on `127.0.0.1` in containers — Docker port mapping won't route.

## Healthcheck contract (probes)

- **Liveness** (`/v1/health`): returns 200 if the process is alive. No DB call.
- **Readiness** (`/v1/health/ready`): returns 200 only if DB and object store are reachable. Probe-only; not for clients.

```ts
app.get('/v1/health/ready', async (c) => {
  const ok = await Promise.all([pingDb(), pingObjectStore()]).then(
    (r) => r.every(Boolean),
    () => false,
  );
  return c.json({ ready: ok }, ok ? 200 : 503);
});
```
