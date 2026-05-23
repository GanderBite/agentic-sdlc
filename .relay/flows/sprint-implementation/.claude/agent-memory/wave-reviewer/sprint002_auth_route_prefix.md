---
name: sprint002-auth-route-prefix
description: MedBridge auth routes use dotted-RPC style under /api (e.g. /api/auth.login, /api/auth.refresh), NOT REST-style /v1/auth/login paths.
metadata:
  type: project
---

ARCHITECTURE.md §6.1 + sprint-002 task-auth-routes both specify routes as `POST /api/auth.login`, `POST /api/auth.refresh`, `POST /api/auth.logout`, `GET /api/auth.me`. The wave-5 csrf middleware shipped exempt paths `/v1/auth/login` and `/v1/auth/refresh` which DO NOT MATCH — login requests would 403 because they cannot carry a csrf token yet.

**Wave-7 update:** Instead of fixing csrf.ts EXEMPT_PATHS to `/api/auth.*` per the wave-5 finding's suggested_fix, wave-7's auth/routes.ts was authored to MATCH the wrong /v1/auth prefix — registering `/login`, `/refresh`, `/logout`, `/me` and explicitly documenting "mount at /v1/auth" in the header comment. The recurrence pattern: when an auto_fixable finding is left unfixed, the NEXT wave often doubles down on the wrong side instead of correcting it. The reviewer must flag any new file that aligns with the prior wrong-shape as `[blocking]` with cross-wave escalation_reason.

**Wave-8 third recurrence:** app.ts mounts the auth router at `/api` (not `/v1/auth`, not `/api/auth`) and the task-app description itself says "mount at /api". Combined with wave-7's REST-style routes.ts (`/login`, etc.), runtime paths are now `/api/login`, `/api/refresh`, etc. — matching NEITHER ARCHITECTURE §2.2 (dotted RPC `/api/auth.login`) NOR csrf EXEMPT_PATHS (`/v1/auth/login`). Every POST login attempt will 403. THE TASK DESCRIPTION ITSELF IS WRONG — planner copied a mid-stream value rather than reading ARCHITECTURE. The fix now requires (a) coordinated edits across app.ts mount, routes.ts paths, csrf EXEMPT_PATHS, AND (b) correcting the task-app description in `.planning/sprints/sprint-002.tasks.json`. Downgraded `auto_fixable` to false because no single-file fixer can resolve it. Per verification-gates R7.3 this is a clear protocol/planner gap, not finding noise.

**Why:** RPC-style `<resource>.<verb>` is the only convention used in this codebase; any `/v1/...` or `/api/v1/...` patterns indicate an LLM drifted to REST conventions from training data.

**How to apply:** When auditing middleware, routes, or test fixtures, grep for `/v1/` and `/api/v1/` prefixes — if present, raise as `[blocking]` (security / wrong route exemption or routes unreachable from SPA) or `[high]` (test fixture pointing nowhere). The canonical paths are `/api/<module>.<verb>`. Always cross-check against [[sprint002-biome-quote-recurrence]] — both are builder-side drift classes. When the prefix bug appears in a SECOND file in a later wave, escalate with `meta.escalated: true` even if technically a different (file, line) — the fixer-protocol gap is the underlying defect.
