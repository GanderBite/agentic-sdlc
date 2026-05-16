---
name: project-sprint001-env-eager-load
description: sprint-001 wave-3 introduced apps/api/src/shared/env.ts with eager `export const env = loadEnv()`; breaks DI for JWT_SECRET fail-fast test in wave-7.
metadata:
  type: project
---

apps/api/src/shared/env.ts ends with `export const env: Env = loadEnv()`. Logger.ts imports that singleton at module scope. Any test/build importing logger (or anything that transitively imports env) throws at import time unless DATABASE_URL + ≥32-byte JWT_SECRET are in process.env.

**Why:** Wave-7 integration test `auth.boot-jwt-secret.test.ts` (planned per task-test-integration-security) does `buildApp({ ...env, JWT_SECRET: 'too-short' })` to assert fail-fast. With eager singleton, the throw fires during the test runner's module-graph load, before vitest can even register the test. Also wave-7 smoke `pnpm -r test` will fail to collect tests in apps/api without an .env shim.

**How to apply:** When reviewing wave-4+ work, watch for any module that imports `env` from `./env.js` as a singleton — flag as architecture/high. Suggested fix path: convert to `createLogger(env)` and `loadEnv(source)` only, with main.ts being the sole call site for `loadEnv(process.env)`. Recorded in findings-wave-3.json F-001/F-002.
