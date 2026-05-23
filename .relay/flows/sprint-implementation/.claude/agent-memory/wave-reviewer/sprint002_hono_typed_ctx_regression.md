---
name: sprint002-hono-typed-ctx-regression
description: Hono router-scoped c.get('key') trips TS2769 because Variables env is empty; middleware/* files use the same untyped pattern but typecheck OK because MiddlewareHandler widens c — symptom of missing AppEnv type contract.
metadata:
  type: project
---

**Pattern:** `apps/api/src/modules/auth/routes.ts:161` and `:199` use `c.get('requestId')` / `c.get('user')` inside a `new Hono()`-scoped handler. TypeScript reports TS2769 "Argument of type 'requestId' is not assignable to parameter of type 'never'" because the router's `Hono<{}>` env has no `Variables` declaration.

**Why this surfaces in routes.ts but NOT in middleware/*.ts:** `middleware/logger.ts`, `middleware/errorHandler.ts`, `middleware/authz.ts` all use the same `c.get(...) as ... | undefined` pattern. They typecheck because their function signature is `MiddlewareHandler` (no env type) — TypeScript widens `c.get` to `(key: string) => unknown`. The router-scoped `c` inside `router.post('/refresh', async (c) => ...)` is typed against the empty router env, so `c.get<key>` infers `key: never`.

**Recurrence chain:** wave-5 do-not-recur L13 noted "Hono ctx variables used via untyped `as` casts; no typed HonoEnv Variables interface". Marked `auto_fixable: false`. NOTHING was done. It surfaced again in review-iter-2 as a HARD typecheck failure (gate-replay exit=2) because something in the iter-1 fix commit tightened a related type and pushed routes.ts past the threshold.

**How to apply:** Future sprints that add modules with router-scoped `c.get(...)` should be flagged BEFORE they ship. The fix is one-time: declare `type AppEnv = { Variables: { requestId: string; log: pino.Logger; user?: { id: string; email: string; role: 'patient' | 'doctor' } } }` in `apps/api/src/shared/honoEnv.ts` and parameterise every `new Hono<AppEnv>()` + `MiddlewareHandler<AppEnv>`. Drop the `as ... | undefined` casts. This is a contract bug, not a per-file bug — flag it as a blocking finding on the FIRST router file in any new module.
