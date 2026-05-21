---
name: middleware-order-set-too-late
description: Hono apps composing global per-route middleware before handlers + per-route opt-out flags set inside handler body produce unreachable bootstrap routes
metadata:
  type: project
---

In sprint-001 wave-10, apps/api/src/main.ts registered `apiRouter.use('*', csrf)` and `apiRouter.use('*', authn)` globally, while routes.ts set `c.set(ALLOW_PUBLIC_KEY, true)` INSIDE the `auth.login` and `auth.refresh` handler bodies. The middleware chain runs in registration order, so csrf rejects bootstrap POSTs with 403 before the handler runs — auth.login is unreachable through `buildApp()`.

**Why:** Hono middleware composes before handlers. Per-route exemption requires the flag to be visible to upstream middleware via either (a) per-route `.post(path, middleware, handler)` chaining (as auth.logout/auth.me already do) or (b) a route-table lookup inside the middleware itself.

**How to apply:** When auditing app composition that mixes global protective middleware with route-handler opt-out flags, trace the execution order. If the opt-out flag is set in the handler body, the middleware never sees it — flag this as blocking. Also flag any test suite that bypasses the production composition (e.g. by building its own router-only app to "test the routes"): tests that skip the real middleware chain cannot catch composition defects. Cross-reference [[recurring-test-bypass-production-composition]].
