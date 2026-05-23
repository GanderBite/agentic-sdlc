# env-vars

Reference for Vite 7 environment variables as used in `apps/ui`.

## File cascade

Vite loads env files from the package root (`apps/ui/`) in this order. Later files override earlier ones:

1. `.env` — always loaded.
2. `.env.local` — always loaded, gitignored.
3. `.env.[mode]` — loaded for the active mode (`development`, `production`, or a custom mode).
4. `.env.[mode].local` — same, gitignored.

`mode` is set by Vite:

- `vite` (dev) → `mode = "development"`.
- `vite build` → `mode = "production"`.
- `vite build --mode staging` → `mode = "staging"` (only if explicitly invoked).

For MedBridge we use exactly two modes: `development` and `production`. Do not invent `staging`, `qa`, or other modes unless the deployment topology changes.

## Required files in `apps/ui/`

| File | Status | Purpose |
|---|---|---|
| `.env.example` | committed | Documents every `VITE_` var with a placeholder value. Source of truth for the schema. |
| `.env.development` | committed | Defaults for `vite` dev server (e.g., `VITE_API_BASE_URL=/api`). |
| `.env.production` | committed | Defaults for `vite build` (e.g., `VITE_API_BASE_URL=/api`). |
| `.env` | gitignored | Developer overrides (rarely needed). |
| `.env.local`, `.env.development.local`, `.env.production.local` | gitignored | Personal overrides. |

## Exposure rule

Only variables prefixed with `VITE_` are exposed to client code. Vite's `envPrefix` defaults to `["VITE_"]` — do not change it.

```env
# .env.example
VITE_API_BASE_URL=/api          # exposed to import.meta.env.VITE_API_BASE_URL
DATABASE_URL=postgres://...      # NOT exposed — never put secrets in apps/ui anyway
```

## Reading env vars

In source TypeScript:

```ts
const base = import.meta.env.VITE_API_BASE_URL; // typed via ImportMetaEnv

if (import.meta.env.DEV) {
  // built-in flag: true when mode === 'development'
}

if (import.meta.env.PROD) {
  // built-in flag: true when mode === 'production'
}

const mode = import.meta.env.MODE; // "development" | "production"
```

Built-in fields exposed by Vite (do not redeclare on `ImportMetaEnv`):

- `MODE: string`
- `BASE_URL: string`
- `DEV: boolean`
- `PROD: boolean`
- `SSR: boolean`

Custom fields are declared in `apps/ui/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  // Add one readonly string per custom VITE_ var.
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## Pitfalls

1. **Treating env vars as runtime config.** They are substituted at build time. Changing `.env.production` after `vite build` has no effect on an existing `dist/`. Rebuild and redeploy.
2. **Putting secrets in `VITE_` vars.** Anything `VITE_`-prefixed ships to the browser as static text inside the bundle. Browser-visible == public.
3. **Using `process.env`.** Not polyfilled. Always `undefined` in browser code; never use it in `apps/ui/src/**`.
4. **Missing the `VITE_` prefix.** `FOO=bar` is loaded into `loadEnv()` results (server-side, inside `vite.config.ts`), but is NOT exposed to client code. Add the prefix.
5. **Quoting values.** `.env` parsers tolerate quotes but include them in the value: `VITE_X="foo"` yields the string `"foo"` with literal quotes in some setups. Prefer unquoted values; quote only when whitespace is significant.
6. **Forgetting to add a new var to `.env.example` and `vite-env.d.ts`.** Both must change in the same PR — `.env.example` is documentation, `vite-env.d.ts` is the type.

## Accessing env inside `vite.config.ts`

Server-side (config) code runs in Node and CAN read non-`VITE_` vars via `loadEnv`:

```ts
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // empty prefix = load all vars
  return {
    server: {
      proxy: {
        '/api': { target: env.API_TARGET ?? 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
```

This is the only place where non-`VITE_` vars are legal in the UI workspace. Use it sparingly and document any non-`VITE_` var read here in `.env.example`.
