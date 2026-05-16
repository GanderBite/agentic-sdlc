# tailwind-integration

Reference for wiring Tailwind CSS 4 into Vite in `apps/ui`. The `tailwind` skill owns Tailwind authoring rules (`@theme`, design tokens, utility usage); this file owns the build-time integration only.

## The wiring (single source of truth)

Tailwind 4 in MedBridge is wired EXCLUSIVELY through `@tailwindcss/vite`. No other configuration files exist.

```ts
// apps/ui/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],  // react first, tailwindcss second
  // ...
});
```

```css
/* apps/ui/src/styles.css — the only CSS entry point */
@import "tailwindcss";

@theme {
  /* design tokens — owned by the `tailwind` skill */
}
```

```ts
// apps/ui/src/main.tsx
import './styles.css';   // imports Tailwind before any component
import { StrictMode } from 'react';
// ...
```

## What does NOT exist in this repo

| File | Status | Why |
|---|---|---|
| `apps/ui/tailwind.config.{js,ts,cjs,mjs}` | NOT present | Tailwind 4 uses CSS-first config via `@theme` blocks. The legacy JS config is a v3 artifact. |
| `apps/ui/postcss.config.{js,cjs,ts,mjs}` | NOT present | `@tailwindcss/vite` runs Tailwind directly. PostCSS is not in the pipeline. |
| `apps/ui/.postcssrc{,.json,.js}` | NOT present | Same as above. |
| `autoprefixer` | NOT installed | Tailwind 4 ships its own vendor-prefix handling via Lightning CSS. |

If any of these files appear in a PR, reject the change.

## Common migration mistakes (from Tailwind 3)

1. **Adding a `tailwind.config.ts`.** v4 still loads it if present, but the project is supposed to be config-as-CSS. Move everything to `@theme {}` in `styles.css`.
2. **Adding a `postcss.config.cjs` with `tailwindcss` and `autoprefixer`.** Doubles the pipeline (Vite plugin AND PostCSS), causes class-extraction inconsistencies between dev and prod builds.
3. **Importing from `'tailwindcss'` instead of `'@tailwindcss/vite'`.** `tailwindcss` is the engine package, not a Vite plugin. The correct import is `import tailwindcss from '@tailwindcss/vite'`.
4. **Forgetting `@import "tailwindcss";` at the top of the CSS entry.** Without this directive, Tailwind emits no utilities and every utility class renders as a no-op.

## Plugin order

```ts
plugins: [react(), tailwindcss()]   // CORRECT
plugins: [tailwindcss(), react()]   // WRONG — see SKILL.md Rule 5
```

Tailwind extracts utility class names by scanning the module graph after transformation. React's JSX transform must run first so that emitted JSX is visible as plain JS that Tailwind can scan.

## How dev mode works

In `vite` dev mode, `@tailwindcss/vite`:

1. Watches every file in the module graph plus glob patterns it derives from `@import "tailwindcss";`.
2. Re-extracts class names on change.
3. Pushes CSS updates through Vite's HMR without a page reload.

You will see CSS changes reflected in the browser within ~50ms in dev. If HMR stops working for CSS, restart `vite` — Tailwind's watcher can desync if files are renamed mid-session.

## How build mode works

In `vite build`, `@tailwindcss/vite`:

1. Walks the full module graph once.
2. Extracts the final set of used utility classes.
3. Emits a single minified CSS chunk to `dist/assets/index-<hash>.css`.

There is no "purge" step to configure — extraction is exhaustive by design.

## Troubleshooting

- **Utilities don't apply at all.** Missing `@import "tailwindcss";` in the CSS entry, or the CSS entry isn't imported from `main.tsx`.
- **A custom class works in dev but not in prod.** Class name is constructed dynamically (e.g., `` `bg-${color}-500` ``). Tailwind cannot extract dynamic names. Use a full static class string in source or move the conditional to a `class-variance-authority` / `clsx` setup with all variants spelled out.
- **`@theme` tokens not applied.** `@theme` blocks must be inside the same CSS file that `@import`s Tailwind, or in a file that is `@import`ed before any utility usage in source.
