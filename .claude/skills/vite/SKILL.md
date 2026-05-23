<!-- version: 1.0.0 -->

# vite

## Purpose

Encodes how `apps/ui` in MedBridge is built and served by Vite 7: `vite.config.ts` shape, plugin order, dev-server proxy to `apps/api`, env vars, build output, and the production `dist/` + nginx contract.

## Consumers

- `builder` — edits `apps/ui/vite.config.ts`, `apps/ui/index.html`, `apps/ui/.env*`, and any UI module that reads `import.meta.env`.
- `code-reviewer` — checks PRs touching `apps/ui/vite.config.ts`, `apps/ui/index.html`, env files, or the UI Dockerfile / nginx config.

## Stack constants (do not deviate)

- Vite `^7.0.x`. Single config at `apps/ui/vite.config.ts` written in TypeScript via `defineConfig`.
- Plugins (registration order matters): `@vitejs/plugin-react` first, then `@tailwindcss/vite`. No other plugins unless this skill is updated.
- Tailwind 4 is wired via `@tailwindcss/vite` only. Never add `postcss.config.{js,cjs,ts}` or `tailwind.config.{js,ts}` — see `references/tailwind-integration.md`.
- React 19 with the React plugin's default transform (automatic JSX runtime, Fast Refresh). Never disable Fast Refresh.
- TypeScript 5.7 strict. `tsc --noEmit` owns typechecking. Vite (esbuild internally) handles `.ts`/`.tsx` transformation only — Vite is never the source of type errors.
- Dev: `pnpm --filter @medbridge/ui dev` → Vite dev server on `localhost:5173`, proxying `/api/*` to `apps/api` on `localhost:3000`.
- Prod: `pnpm --filter @medbridge/ui build` → static `apps/ui/dist/` served by `nginx:1.27-alpine` in `docker-compose.yml`. No SSR, no Node server in front of the bundle.

## Rules

### Config file shape

1. Define the config with `defineConfig` from `vite` — never export a plain object literal. `defineConfig` gives type inference for plugin and server options.
2. Keep exactly one `vite.config.ts` at `apps/ui/vite.config.ts`. Never add `vite.config.js`, `vite.config.mjs`, or environment-specific siblings (`vite.config.prod.ts`). Branch behavior inside the config using the `({ mode, command }) => ({ … })` form when needed.
3. Pin `root` to the package directory by leaving it implicit (Vite uses `process.cwd()`). Never set `root` to an absolute path or a parent of the workspace.
4. Set `publicDir` to its default `public/`. Files placed in `apps/ui/public/` are copied verbatim into `dist/` at build time. Never reference them with an import — use absolute paths from `/` in HTML/JSX.

### Plugin registration

5. Register `react()` from `@vitejs/plugin-react` first, then `tailwindcss()` from `@tailwindcss/vite`. Order: React-first ensures JSX is parsed before Tailwind's CSS pipeline runs.
6. Never import the Tailwind plugin from `tailwindcss/plugin` or `postcss-tailwindcss`. The only correct import is `import tailwindcss from '@tailwindcss/vite'`.
7. Never pass options to `react()` to override the JSX runtime or Babel plugins unless this skill is updated to record why.

### Dev server and proxy

8. Set `server.port` to `5173` and `server.strictPort` to `true`. A taken port must fail loudly, not silently shift.
9. Set `server.host` to `true` only if a docker-compose service binds to the dev server. For plain local dev leave it unset (binds to `localhost` only).
10. Proxy every API call through `server.proxy['/api']` to the `apps/api` loopback host (`localhost:3000`) with `changeOrigin: true`. Never hardcode a scheme+host into UI source — call relative `/api/...` paths so the proxy (dev) and nginx (prod) own the routing. Full literal target string in `references/proxy-and-nginx.md`.
11. Never set `server.proxy['/api'].rewrite` to strip the `/api` prefix. `apps/api` mounts its routes under `/api/*`; the prefix is part of the URL contract.
12. Never enable `server.hmr.overlay: false`. The HMR error overlay is the developer's first signal that a render is broken.

### Env vars

13. Expose runtime config to UI code only through env vars prefixed `VITE_`. A `FOO=bar` in `.env` is invisible to `import.meta.env`; `VITE_FOO=bar` is exposed.
14. Read env vars via `import.meta.env.VITE_FOO` in source. Never read `process.env` in `apps/ui/src/**` — Vite does not polyfill it.
15. Keep env files at `apps/ui/.env` (gitignored), `apps/ui/.env.example` (committed, documents every required var), `apps/ui/.env.development`, `apps/ui/.env.production`. Never put secrets in any `.env*` under `apps/ui/` — every `VITE_` var ships to the browser.
16. Type `import.meta.env` by extending `ImportMetaEnv` in `apps/ui/src/vite-env.d.ts`. Add one field per `VITE_` var, marked `readonly` and `string`.

### Build

17. Run prod builds with `vite build`. Output goes to `apps/ui/dist/`. Never override `build.outDir` to a path outside `apps/ui/`.
18. Set `build.sourcemap` to `true`. Source maps ship to `dist/`; nginx serves them; production debugging depends on them.
19. Leave `build.target` at Vite 7's default (`baseline-widely-available`). Never raise it to `esnext` or lower it to `es2015` without a recorded reason.
20. Never set `base` to a non-`/` value. The UI is served from the site root by nginx; a non-root `base` breaks asset URLs.
21. Run `pnpm --filter @medbridge/ui typecheck` (`tsc --noEmit`) before/alongside `vite build`. Vite will not fail on type errors — `tsc` is the gate.

### Preview and static serving

22. Use `vite preview` only for smoke-testing the prod bundle locally on port `4173`. Never use `vite preview` in any deployed environment — production is nginx serving `dist/`.
23. nginx must be configured to fall back unmatched routes to `/index.html` so TanStack Router client-side routes resolve on hard refresh. See `references/proxy-and-nginx.md`.

### Assets

24. Import static assets (images, fonts, SVGs) from TypeScript with a relative path: `import logo from './logo.svg'`. Vite returns a URL string; the file is hashed and emitted to `dist/assets/`.
25. Put files that must keep a stable, unhashed URL (e.g., `robots.txt`, `favicon.ico`) in `apps/ui/public/`. Reference them as absolute paths (`/favicon.ico`) — never `import`.
26. Use the `?url` and `?raw` import suffixes for explicit URL or raw-string imports. Never use `?worker` or `?inline` — they are out of scope for the current bundle.

## Template — `apps/ui/vite.config.ts`

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),         // REQUIRED — must come before tailwindcss()
    tailwindcss(),   // REQUIRED — Tailwind 4 wired via Vite plugin only
  ],
  server: {
    port: 5173,           // REQUIRED
    strictPort: true,     // REQUIRED — fail loud on port conflict
    proxy: {
      '/api': {           // REQUIRED — every /api/* call flows through here in dev
        target: API_TARGET,        // see references/proxy-and-nginx.md for the literal value
        changeOrigin: true,
        // OPTIONAL: ws: true — only if WebSocket endpoints land under /api
      },
    },
  },
  build: {
    outDir: 'dist',       // REQUIRED — matches Dockerfile COPY and nginx root
    sourcemap: true,      // REQUIRED — prod debugging
    // OPTIONAL: target — defaults to baseline-widely-available; do not override
  },
  // OPTIONAL: preview.port — defaults to 4173; only override if 4173 is reserved
});
```

`API_TARGET` is the loopback URL `<scheme>://localhost:3000`. See `references/proxy-and-nginx.md` for the copy-paste-ready literal and the prod nginx counterpart.

`apps/ui/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;   // REQUIRED — defaults to "/api"
  // Add one readonly string per VITE_ var. No optional fields; document defaults in .env.example.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## Examples

### CORRECT — env access and relative API calls

```ts
// apps/ui/src/api/client.ts
const base = import.meta.env.VITE_API_BASE_URL; // "/api" in dev and prod

export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`); // -> /api/patients in browser
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
```

WHY this is correct: relative `/api` paths let `server.proxy` (dev) and nginx (prod) route to `apps/api` without code changes; `import.meta.env.VITE_API_BASE_URL` is the only supported runtime-config channel (Rules 10, 13, 14).

### INCORRECT — hardcoded loopback host

```ts
// apps/ui/src/api/client.ts
const res = await fetch(`<scheme>://localhost:3000/api/patients`); // BAD
```

WHY this is wrong: violates Rule 10 (bypasses the dev proxy and the prod nginx contract) and is unreachable in production where nginx, not localhost, fronts the API.

### INCORRECT — reading `process.env` in UI code

```tsx
// apps/ui/src/components/Banner.tsx
const flag = process.env.NEXT_PUBLIC_FEATURE_X; // BAD
```

WHY this is wrong: violates Rule 14 (Vite does not polyfill `process.env` for browser code) and Rule 13 (no `VITE_` prefix). `flag` is `undefined` at runtime.

### INCORRECT — adding a PostCSS config for Tailwind

```js
// apps/ui/postcss.config.cjs
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }; // BAD
```

WHY this is wrong: violates the Tailwind-4 wiring rule (Stack constants, Rule 6). Tailwind 4 in this repo is configured exclusively through `@tailwindcss/vite`; a PostCSS config doubles the pipeline and breaks build reproducibility.

### INCORRECT — plugin order reversed

```ts
plugins: [tailwindcss(), react()]; // BAD
```

WHY this is wrong: violates Rule 5. Tailwind's CSS pipeline must run after React's JSX transform; reversing the order causes class-extraction failures for JSX-emitted markup in some setups.

## Deeper reference

- `references/env-vars.md` — full `import.meta.env` shape, `.env.*` cascade, type augmentation pitfalls.
- `references/proxy-and-nginx.md` — dev proxy options, prod nginx SPA fallback, end-to-end `/api` contract, literal `target:` value.
- `references/build-and-assets.md` — build options, chunking, asset hashing, `public/` vs imports, `?url`/`?raw`.
- `references/tailwind-integration.md` — why Tailwind 4 uses only the Vite plugin; common migration mistakes from v3.
