# `@tailwindcss/vite` setup notes

## `vite.config.ts` (`apps/ui/vite.config.ts`)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
```

Notes:

- Plugin order: `react()` first, `tailwindcss()` second. `tailwindcss()` hooks into Vite's CSS pipeline and the `transformIndexHtml` step.
- No `postcss.config.{js,ts}` file. If one exists at the repo root, Vite picks it up automatically — delete it during migration to v4.
- No `tailwind.config.{js,ts}` file. Tailwind 4 reads all config from CSS.
- The `@` alias points to `apps/ui/src`. `cn(...)` and other helpers should import from `@/lib/utils`.

## Entry stylesheet location

```
apps/ui/src/
  main.tsx          # imports ./styles/index.css
  styles/
    index.css       # the ONLY Tailwind entry; @import "tailwindcss";
```

Do **not** add per-route `.css` files unless you need a CSS Module (`*.module.css`) for a third-party widget that resists utility classes. CSS Modules participate in Vite's pipeline but are NOT processed by `@tailwindcss/vite` — `@apply` is unavailable inside them.

## HMR behavior

`@tailwindcss/vite` watches:
- The entry CSS file
- All files reachable in Vite's module graph (so any new component is picked up automatically when Vite serves it)

Edits to `@theme` tokens HMR-update the running app without a reload. Edits to `@layer base` blocks reload the page.

## Monorepo path resolution

`@tailwindcss/vite` discovers classes via Vite's module graph, so it automatically scans:
- Anything imported (directly or transitively) from `apps/ui/src/main.tsx`.
- Components imported from workspace packages (e.g. `@medbridge/contracts`) IF those packages emit JSX/TSX that gets bundled. `packages/contracts` is types-and-schemas only, so no classes are scanned from it.

If a UI library ever lives in a sibling package and ships precompiled CSS, `@import` that CSS from `index.css` AFTER `@import "tailwindcss"`.

## Source maps

`@tailwindcss/vite` emits source maps in dev. To enable them in production builds:

```ts
build: {
  sourcemap: true,
}
```

Default for MedBridge is `false` in prod (CSS bundle is small; source-mapping atomic utilities is rarely useful).

## Build verification

`pnpm --filter @medbridge/ui build` outputs `dist/assets/index-<hash>.css`. Expected size for an early MedBridge build: 20–60 KB minified, gzipped to 5–15 KB. If the CSS bundle exceeds 200 KB, something has gone wrong — most likely a missed `@theme` override or an accidental `--*: initial` removal of token namespaces.

Check with:

```sh
pnpm --filter @medbridge/ui build
gzip -c apps/ui/dist/assets/index-*.css | wc -c
```

## Common pitfalls

| Symptom                                              | Cause                                                 | Fix                                       |
|------------------------------------------------------|-------------------------------------------------------|-------------------------------------------|
| Classes work in dev, not in prod                     | Source file outside Vite's module graph              | Import the file (even transitively)       |
| `@apply` errors with "unknown utility"               | Used in a non-Tailwind-processed file (CSS Modules)  | Move recipe to `@layer components`        |
| Dark mode flashes white on load                      | Init script missing or placed after the module import| Use the inline `<script>` from `dark-mode.md` |
| Two `<style>` blocks with duplicate base resets      | Multiple entry CSS imports                            | One entry file (Rule 3)                   |
| `text-brand-500` doesn't compile                     | Brand tokens defined as `--brand-500` not `--color-brand-500` | Add the `--color-` prefix          |
| Plugin error "PostCSS plugin Tailwind requires…"     | Leftover PostCSS plugin from v3                       | Delete `postcss.config.*` + uninstall     |
