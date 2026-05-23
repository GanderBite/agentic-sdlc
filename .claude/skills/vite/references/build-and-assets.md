# build-and-assets

Reference for `vite build` output, asset handling, and the `public/` vs import distinction in `apps/ui`.

## `vite build` lifecycle

`vite build`:

1. Loads `apps/ui/vite.config.ts` with `mode = "production"`.
2. Reads `index.html` at the package root as the entry point. Every `<script type="module" src="...">` tag is followed.
3. Resolves the module graph through esbuild for `.ts`/`.tsx` and Rollup for bundling.
4. Emits hashed assets to `apps/ui/dist/assets/` and the rewritten `index.html` to `apps/ui/dist/index.html`.
5. Copies `apps/ui/public/**` verbatim to `apps/ui/dist/`.

`tsc --noEmit` is a SEPARATE step (`pnpm --filter @medbridge/ui typecheck`). Vite does not check types — esbuild strips them. Always run typecheck in CI alongside build.

## Build options reference

```ts
build: {
  outDir: 'dist',          // REQUIRED — matches Dockerfile and nginx root
  sourcemap: true,         // REQUIRED — prod debugging
  emptyOutDir: true,       // default true; clears outDir before build
  // target — leave default 'baseline-widely-available'
  // minify — default 'esbuild'; do not change
  // cssCodeSplit — default true; per-route CSS chunks
  // assetsInlineLimit — default 4096 bytes; small assets become base64 data URLs
}
```

Do not configure `rollupOptions` unless you have a measured bundle-size problem documented in `docs/ARCHITECTURE.md`. Vite's defaults handle code-splitting correctly for the React + TanStack Router stack.

## Assets — three patterns

### 1. Imported assets (hashed, cache-busting)

```ts
import logoUrl from './assets/logo.svg';     // logoUrl === '/assets/logo-3a7b9c.svg'
import iconUrl from './icon.png?url';        // explicit URL import
import rawSvg from './sprite.svg?raw';       // string contents
```

Vite hashes the filename and emits it to `dist/assets/`. Safe to cache forever.

Use for: anything referenced from TS/TSX/CSS. The default — prefer this.

### 2. `public/` directory (unhashed, stable URL)

```
apps/ui/public/
  favicon.ico
  robots.txt
  apple-touch-icon.png
```

Reference with an absolute path: `<link rel="icon" href="/favicon.ico" />`. Never `import` from `public/`.

Use for: files that external systems link to by a fixed URL (search engines, mobile OS touch icons, sitemap.xml).

### 3. `index.html` `<link>`/`<script>` tags

Tags inside `index.html` are parsed by Vite and their `src`/`href` values become part of the module graph. Use the `/src/main.tsx` convention:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MedBridge</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## Import suffixes

| Suffix | Returns | Use case |
|---|---|---|
| (none) on `.svg`/`.png`/... | URL string | default |
| `?url` | URL string (explicit) | when the default would inline (file < `assetsInlineLimit`) |
| `?raw` | string contents | inline SVGs, CSV samples, license text |
| `?inline` | base64 data URL | FORBIDDEN — out of scope; opens an inconsistency in build size |
| `?worker` | Web Worker constructor | FORBIDDEN — out of scope for the current bundle |

## Bundle inspection

After `vite build` Vite prints a summary table:

```
dist/index.html                   0.45 kB │ gzip: 0.30 kB
dist/assets/index-3a7b9c.css     12.34 kB │ gzip: 3.21 kB
dist/assets/index-3a7b9c.js     234.56 kB │ gzip: 78.90 kB
```

If any chunk crosses 500 kB pre-gzip, Vite prints a warning. Investigate before merging — usually it means a dependency was pulled in unintentionally or `lodash` (etc.) is being imported as a whole module rather than per-function.

## `vite preview`

`vite preview` serves `dist/` on `localhost:4173` via a tiny built-in static server. It exists for local smoke-testing only:

- It does NOT run the dev proxy. `/api/*` calls go nowhere.
- It is NOT a production server. Always use nginx in deployed environments.
- It is useful for: verifying the bundle loads, checking SPA-fallback behavior manually (preview supports SPA fallback by default).

To smoke-test against a real API in preview, run `vite preview` plus a local nginx with the prod config, or run `docker compose up`.

## Cleaning `dist/`

`build.emptyOutDir: true` (default) clears `dist/` before each build. If a build process needs to preserve files (it should not, in MedBridge), they belong in `public/` — never co-existing with build output.
