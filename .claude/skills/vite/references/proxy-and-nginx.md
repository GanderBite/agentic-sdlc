# proxy-and-nginx

Reference for the dev `server.proxy` and the prod nginx contract for `apps/ui`.

## The contract

UI source always calls relative paths starting with `/api/...`. Two layers translate that to the real `apps/api` host:

| Environment | Layer | Translation |
|---|---|---|
| Dev (`vite`) | `server.proxy['/api']` in `vite.config.ts` | `/api/x` → `http://localhost:3000/api/x` |
| Prod (`docker compose`) | nginx `location /api/` | `/api/x` → `http://api:3000/api/x` (compose service DNS) |

The `/api` prefix is preserved end-to-end. `apps/api` mounts every route under `/api/*`.

## Dev proxy — full options

```ts
server: {
  port: 5173,
  strictPort: true,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      // OPTIONAL: ws: true — set ONLY if a WebSocket upgrade lands under /api
      // FORBIDDEN: rewrite — never strip the /api prefix
      // OPTIONAL: secure: false — set ONLY if pointing at an https target with a self-signed cert (not the case in MedBridge)
    },
  },
},
```

`changeOrigin: true` is required because Hono on the API side reads the `Host` header for some middlewares; passing the dev server's host (`localhost:5173`) confuses logs and CORS checks.

## Production nginx config

`apps/ui/nginx.conf` (or whatever path the Dockerfile COPYs in):

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;     # the apps/ui/dist/ contents copied here
  index index.html;

  # Proxy /api/* to the api compose service
  location /api/ {
    proxy_pass http://api:3000;   # `api` is the compose service name
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SPA fallback — TanStack Router needs every client-side route to resolve to index.html
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Long-cache hashed assets
  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

## SPA fallback — why it matters

TanStack Router routes like `/patients/123` are resolved client-side from `index.html`. If a user hits that URL with a hard refresh, nginx must serve `index.html` for any path that does not match a file in `dist/` — `try_files $uri $uri/ /index.html;` does exactly that.

Without the fallback, the user gets a 404 on every client-route deep link.

## Asset caching

Vite emits filenames under `dist/assets/` with content hashes (`logo-3a7b9c.svg`). These are safe to cache for a year (`immutable`). Do not apply the same caching to `index.html` — it must be revalidated on every request, otherwise users keep seeing the old bundle after a deploy.

```nginx
location = /index.html {
  add_header Cache-Control "no-cache";
}
```

## Compose wiring

`docker-compose.yml` (excerpt):

```yaml
services:
  ui:
    image: medbridge-ui
    build:
      context: .
      dockerfile: apps/ui/Dockerfile
    ports:
      - "8080:80"
    depends_on:
      - api
  api:
    image: medbridge-api
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    expose:
      - "3000"
```

The UI container's nginx resolves `http://api:3000` via compose DNS. No external port mapping on `api` is required — only nginx talks to it.

## Failure modes

1. **404 on `/api/...` in prod.** nginx's `location /api/` block is missing or the trailing slashes don't match. `proxy_pass http://api:3000` (no trailing slash) keeps the URI; `proxy_pass http://api:3000/` (trailing slash) rewrites it. The MedBridge config uses the no-trailing-slash form deliberately.
2. **CORS errors in dev.** `changeOrigin: false` (or omitted in some Vite configs) causes the API to see `Origin: http://localhost:5173` and reject the call. Set `changeOrigin: true`.
3. **404 on hard refresh of a client route.** SPA fallback missing in nginx. Add `try_files $uri $uri/ /index.html;`.
4. **Stale UI after deploy.** `index.html` cached by nginx or a CDN. Add `Cache-Control: no-cache` for `index.html`.
