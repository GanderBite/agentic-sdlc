---
name: sprint002-auth-route-prefix
description: MedBridge auth routes use dotted-RPC style under /api (e.g. /api/auth.login, /api/auth.refresh), NOT REST-style /v1/auth/login paths.
metadata:
  type: project
---

ARCHITECTURE.md §6.1 + sprint-002 task-auth-routes both specify routes as `POST /api/auth.login`, `POST /api/auth.refresh`, `POST /api/auth.logout`, `GET /api/auth.me`. The wave-5 csrf middleware shipped exempt paths `/v1/auth/login` and `/v1/auth/refresh` which DO NOT MATCH — login requests would 403 because they cannot carry a csrf token yet.

**Why:** RPC-style `<resource>.<verb>` is the only convention used in this codebase; any `/v1/...` or `/api/v1/...` patterns indicate an LLM drifted to REST conventions from training data.

**How to apply:** When auditing middleware or test fixtures, grep for `/v1/` and `/api/v1/` prefixes — if present, raise as `[blocking]` (security / wrong route exemption) or `[high]` (test fixture pointing nowhere). The canonical paths are `/api/<module>.<verb>`. Always cross-check against [[sprint002-biome-quote-recurrence]] — both are builder-side drift classes.
