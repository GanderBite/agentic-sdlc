# task-smoke — BLOCKED

**Wave:** wave-smoke
**Verdict:** fail (escalated per `on_fail: escalate`, `max_attempts: 1`)
**Builder:** backend-builder, attempt 1
**Timestamp:** 2026-05-21T19:50:00Z

## Verification results

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm -r typecheck` | **fail** |
| `pnpm biome check .` | **fail** |
| `pnpm -r build` | **fail** |
| `pnpm -r test` | **fail** (15 failed / 8 passed of 23 test files) |

## Root cause

`apps/api/tsconfig.json` declares `rootDir: "./src"` while also setting `include: ["src/**/*.ts", "test/**/*.ts"]`. These two settings are contradictory: TS6059 fires for the 11 test files in `apps/api/test/integration/` because they sit outside `rootDir`. The error aborts both `pnpm -r typecheck` and `pnpm -r build`.

A prior `tsc -b` invocation partially compiled the test tree before erroring out, emitting stale `.js` and `.d.ts` artifacts into `apps/api/test/integration/` and `apps/api/test/support/`. Those artifacts now cause two further failures:

1. **Biome lint** — the generated files lack trailing newlines and the JSON formatter wants `.relay/flows/*/package.json` collapsed. Biome's existing ignore list does not cover `.relay/` or `test/**/*.{js,d.ts}`.
2. **Vitest** — vitest's default globs discover both the `.ts` source tests AND the stale compiled `.js` copies. The `.js` copies import paths like `../../src/shared/env.js` which do not exist (source has never been fully compiled to that layout), so all `.js`-variant test files fail with module-resolution errors. The `.ts` integration suites pass when run directly (8 files green: login, constant-time, token-family, log-scrub, concurrent-refresh, boot-jwt-secret, seed.idempotent + the auth.service unit suite). Some `.ts` files (refresh, logout, me, csrf) report skipped suites and one duplicate-key constraint violation indicating test-isolation issues across container reuse.

## Required fixes (escalate to sprint owner / next wave)

1. **`apps/api/tsconfig.json`** — split into a build tsconfig (`tsconfig.build.json`) with `rootDir: "./src"` and `include: ["src/**/*.ts"]` only, and let the main `tsconfig.json` cover both src+test for IDE/typecheck without `rootDir`. Or remove `rootDir` from the existing tsconfig.
2. **Delete stale compiled artifacts** from `apps/api/test/integration/*.js`, `apps/api/test/integration/*.d.ts`, and `apps/api/test/support/*.js`. Add `apps/api/test/**/*.{js,d.ts}` to `.gitignore` (or scope to `!**/*.test.ts`).
3. **Biome ignore list** — extend `biome.json` `files.ignore` to cover `.relay/**` and compiled test artifacts, OR auto-format the `.relay/flows/*/package.json` files.
4. **Test isolation** — investigate the duplicate-key violation on `user_email_unique` in `auth.refresh.test.ts`; likely a fixture / pg-per-file harness issue allowing email collision across rapid container reuse.

## Reproducer

```bash
cd /private/var/folders/pw/bl3pw0pj7dxdvb0kdz05k6pc0000gn/T/relay-worktrees/fc7575
pnpm install --frozen-lockfile
pnpm -r typecheck   # fails with TS6059 for 11 test files
pnpm biome check .  # fails on .relay/flows/*/package.json and stale .js/.d.ts
pnpm -r build       # same TS6059 errors abort tsc -b for @medbridge/api
pnpm -r test        # 15 of 23 test files fail (all .js artifact duplicates)
```

## Disposition

- `task-smoke` exhausted `max_attempts: 1` → escalated to blocked.
- Wave-smoke verdict: **blocked**.
- Sprint cannot ship until acceptance bullet 1 (`pnpm install --frozen-lockfile` + `pnpm -r typecheck` succeed) is restored. A follow-up wave is required to fix `apps/api/tsconfig.json` and purge the stale compiled artifacts.
