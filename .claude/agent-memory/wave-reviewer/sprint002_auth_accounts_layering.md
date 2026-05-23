---
name: sprint002-auth-accounts-layering
description: ARCHITECTURE.md §2.3 forbids service.ts from importing another module's schema.ts, but sprint-002 auth tasks instruct repo.ts/service.ts to query the user table directly because password_hash is inline on user (no separate credential table). Surface as architecture finding even when planner-approved.
metadata:
  type: project
---

In sprint-002 the planner deliberately mandates that `apps/api/src/modules/auth/repo.ts` import `apps/api/src/modules/accounts/schema.ts` and run drizzle queries against `user.passwordHash`. ARCHITECTURE.md §2.3 explicitly forbids: "service.ts MAY ... never another module's repo.ts, routes.ts, or schema.ts" and "repo.ts ... never imports another module". The reason for the deviation is `ARCHITECTURE.md §2.2 password_hash is a column on user rather than a separate credential table` — auth needs to read accounts-owned column.

**Why:** A reviewer surfacing this as a finding is correct even though the planner approved it; the postmortem signal exists so the next sprint either (a) introduces accounts/repo.findUserByEmail (proper accounts public surface), or (b) records the deviation in `.planning/intel/conventions.md` explicitly. Silently accepting the import drifts the codebase away from the documented layering rule.

**How to apply:** When auditing wave-6+ tasks of sprint-002 (auth-service, seed, auth-routes), flag any auth/* file that imports `../accounts/schema.js` as an architecture finding. Severity: `high` for service.ts (which also runs the query inline rather than delegating to repo.ts), `medium` for repo.ts (planner-approved deviation that lacks a documented conventions entry). The same shape applies to seed/main.ts importing accounts/schema directly when the architecture says seed should call repo layers.
