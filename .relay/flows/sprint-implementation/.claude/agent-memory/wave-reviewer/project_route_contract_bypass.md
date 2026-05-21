---
name: project_route_contract_bypass
description: Route handlers occasionally call c.json(rawDbRow) directly instead of parsing through the response Zod contract; this leaks columns like passwordHash, deletedAt, createdAt.
metadata:
  type: project
---

Route handlers sometimes serialize `result.user` (a Drizzle `$inferSelect` row) directly via `c.json({ user: result.user }, 200)` without parsing through the corresponding response schema (e.g. `meResponse.parse({ user: result.user })`). Drizzle row types include columns the contract intentionally omits (`passwordHash`, `createdAt`, `deletedAt`), and Zod `.object()` defaults to `.strip()`, so going through the schema is the only thing preventing those columns from reaching the JSON response.

**Why:** ARCHITECTURE §5.4 forbids returning passwords/hashes in any response; the contract schemas in `packages/contracts` are the enforcement mechanism. Skipping the parse is a silent leak that lint and unit tests will not catch.

**How to apply:** When auditing any `apps/api/src/modules/*/routes.ts`, grep for `c.json(` lines whose payload is `result.<name>` or a destructured DB row — cross-reference each with the matching response schema in `packages/contracts/src/<module>.ts`. Findings of this class are blocking + auto_fixable (single import + wrap in `.parse()`).
