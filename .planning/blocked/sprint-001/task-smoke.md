# task-smoke — BLOCKED at wave-smoke

**Wave:** wave-smoke (terminal smoke gate)
**Attempts:** 1/1 — `on_fail: escalate`
**Verdict:** fail
**Date:** 2026-05-16

## Gate results

| Gate       | Outcome | Notes                                                    |
|------------|---------|----------------------------------------------------------|
| install    | PASS    | `pnpm install --frozen-lockfile` — 327ms                 |
| typecheck  | **FAIL** | 18 TS errors in `apps/api` (see below)                  |
| lint       | **FAIL** | 55 errors, ALL in `.relay/`, `.planning/`, `.claude/`   |
| build      | **FAIL** | Same TS errors as typecheck block `tsc -b` emit         |
| test       | PASS    | 12 files, 59 tests passed (unit + integration) in 11.45s |

## Root causes

### 1. TS5097 — 14 occurrences (typecheck + build)

Relative imports in `apps/api/src` use explicit `.ts` extensions, which `tsc -b` rejects unless `allowImportingTsExtensions: true` (incompatible with emit). Files:

- `src/db/client.ts:5,6`
- `src/db/schema.ts:1`
- `src/modules/auth/repo.ts:4,5`
- `src/modules/auth/service.ts:29,34,35`
- `src/modules/auth/service.test.ts:71,73`
- `src/seed/main.ts:1-4`

**Fix:** strip `.ts` extensions from all relative imports across those files.

### 2. TS7053 — `src/modules/auth/repo.ts:84`

`result[0]` indexed on union type `any[] | QueryResult<never>`. Needs narrowing or reconciliation of the Drizzle query return type.

### 3. TS7022 / TS7024 — `src/modules/auth/schema.ts:25,34`

Circular reference on `refreshToken` table definition leaks implicit `any`; `relations` callback at line 34 lacks an explicit return type.

### 4. Biome lint scope (lint gate)

`pnpm biome check .` walks the repo root. The 55 diagnostics are entirely in relay tooling directories (`.relay/`, `.planning/`, `.claude/`) — `pnpm biome check apps/ packages/` succeeds with zero diagnostics across 49 files.

**Fix options:**
- Add `.relay/`, `.planning/`, `.claude/` to `biome.json` `files.ignore`, OR
- Change the smoke gate to scope `pnpm biome check apps/ packages/`, OR
- Clean up the relay tooling files to satisfy biome (not recommended — those files are framework-owned).

## Recommended follow-up

A dedicated follow-up wave (or human PR) needs to:
1. Strip `.ts` import extensions across `apps/api/src/**`.
2. Annotate `refreshToken` table / relations to break the circular `any`.
3. Tighten the Drizzle return-type narrowing in `repo.ts`.
4. Update `biome.json` to ignore relay tooling directories.

Tests already pass (59/59), so behavior is correct — these are purely typecheck/build/lint hygiene fixes.
