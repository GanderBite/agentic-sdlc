# task-smoke — Blocked (escalated)

## Gate failure

`pnpm -w lint` exits 1 (expected 0).

## Root cause

Two biome lint/format errors in UI code created during waves 3-4:

1. **apps/ui/src/features/login/LoginForm.tsx:1:1** — `assist/source/organizeImports`: imports are not sorted per biome rules.
2. **apps/ui/vite.config.ts** — `format`: formatter would have printed different content (whitespace/formatting mismatch).

Both are auto-fixable via `biome check --write`.

## Passing gates

- `pnpm install --frozen-lockfile` — exit 0
- `pnpm -w typecheck` — exit 0
- `pnpm -F @medbridge/api build` — exit 0

## Recommendation

Run `biome check --write apps/ui/src/features/login/LoginForm.tsx apps/ui/vite.config.ts` in the review-fix-loop to resolve both errors.
