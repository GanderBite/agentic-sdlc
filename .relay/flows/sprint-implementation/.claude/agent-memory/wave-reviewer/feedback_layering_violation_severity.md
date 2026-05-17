---
name: layering-violation-severity-blocking
description: Hard-rule ARCHITECTURE.md §2.3 layering violations (e.g. service.ts importing db client / schema directly) must be flagged blocking, not medium.
metadata:
  type: feedback
---

When a wave's service.ts (or any non-repo file in a module) imports the Drizzle `db` client or another module's `schema.ts`, classify as `blocking` per the §10.2 severity rubric, not `medium`.

**Why:** The rubric is explicit — "hard-rule architecture layering violations" → blocking. ARCHITECTURE §2.2 phrases the rule as absolute: "repo.ts: The only file in the module that touches the db client." §2.3 lists what service.ts MAY import (repo.ts, shared/, other modules' index.ts) — db client and schema.ts are not on that list. Prior wave-7 reviewer downgraded an analogous violation to `medium` for pragmatic reasons (deliverable works, downstream waves can proceed), but the proper escalation path is `blocking` + `auto_fixable: false` so the orchestrator routes to `.planning/blocked/<sprint>/<task>.md` for scope extension.

**How to apply:** Whenever auditing a `modules/<name>/service.ts` and seeing imports from `../../db/client.js` or `./schema.js`, raise blocking. Mark `auto_fixable: false` because the fix needs scope extension (the missing repo function lives outside the task's target_files). The fix-builder run then extends `task.target_files.may_also_touch` to include `repo.ts` and adds `findUserById` (or analogous) there.

Sprint-001 wave-7 instance: service.ts inlined `db.select().from(user)...` for `me()` and `refresh()` because repo.ts shipped without `findUserById`. The planner missed it. The right repair is plan-side (extend target_files), not "accept the deviation as medium."

See [[project_env_eager_load]] for the related env-singleton issue that also stems from missing DI in this same service.
