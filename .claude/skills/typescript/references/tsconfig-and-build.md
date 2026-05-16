# tsconfig and build expectations

The monorepo has three TypeScript-producing workspaces with distinct build profiles. Choices here cascade into emitted JS, runtime behavior, and cross-workspace contracts.

## Shared baseline

All workspaces inherit (directly or via `extends`):

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `target`: ES2022 or newer
- `module`: `NodeNext` for backend / `ESNext` for frontend
- `moduleResolution`: `NodeNext` / `Bundler`
- `isolatedModules: true` — required so every file is independently transpilable (matters for `tsx`, `swc`-based tools, and incremental builds)
- `noEmitOnError: true` — never ship JS for a type-failing build
- `verbatimModuleSyntax: true` (recommended) — pairs with Rule 15 to make `import type` enforcement strict

## `apps/api` — `tsc` direct, no bundler

- Build command: `tsc -p tsconfig.build.json`. Output: `dist/`. Entry: `dist/main.js`.
- Dev: `tsx src/main.ts`. `tsx` strips types at runtime; it does not type-check. Type errors surface only in CI / `tsc --noEmit`.
- Because there is no bundler, **every type-only import must use `import type`** or `tsc` will emit a `require`/`import` that fails at runtime (e.g. importing a type from a `.ts` file that has no runtime exports).
- Relative imports across files compiled together: include the `.js` extension in the source (`import "./db.js"`), per Node ESM resolution rules. `tsc` will not rewrite extensions.

## `apps/ui` — bundler (Vite or similar)

- The bundler is the source of truth for module resolution. `import type` is still required (Rule 15) for clarity and to avoid surprising runtime imports during HMR.
- Path aliases (`@/...`) are defined in both `tsconfig.json#paths` and the bundler's config. Keep them in sync.
- React JSX: `"jsx": "react-jsx"`. Never import `React` solely for JSX.

## `packages/contracts` — published types and schemas

- Built with `tsc` to emit both `.d.ts` and `.js`. Consumed via `workspace:*`.
- `package.json` exports map controls public surface:
  ```json
  {
    "exports": {
      ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    }
  }
  ```
- Do not import from deep paths in consumers. The exports map is the API.
- Treat every type/value exported from `contracts` as a breaking-change surface. Bump major when removing or renaming.

## Project references (if used)

If `tsconfig.json` uses `references: [{ "path": "../contracts" }]`:

- Run `tsc --build` (not `tsc`) at the repo root.
- `contracts` must set `"composite": true` and emit `.d.ts`.
- Consumers see the referenced project's `.d.ts`, not its source. Re-build `contracts` after changes.

## Common build pitfalls

1. **Phantom runtime import of a type-only symbol** under `tsc` → `Cannot find module` at runtime. Fix: `import type`.
2. **Missing `.js` extension** on relative ESM imports → Node ESM resolver fails. Fix: append `.js` in source (TypeScript accepts it as an alias for the `.ts` file).
3. **`workspace:*` not resolving** in published artifacts → ensure `pnpm` rewrites versions on publish, or use `workspace:^` semantics.
4. **`tsx` masks type errors during dev** → run `tsc --noEmit` in CI on every PR.
5. **Mixing CommonJS deps with NodeNext** → import default explicitly or use `esModuleInterop: true`.

## Files an agent must read before editing TS infra

- `tsconfig.base.json` (or root `tsconfig.json`) — baseline compiler options.
- `apps/<app>/tsconfig.json` and `tsconfig.build.json` — app-specific overrides.
- `packages/contracts/package.json` — exports map and `types` field.
- `package.json` scripts — discover the canonical build/test commands rather than guessing.
