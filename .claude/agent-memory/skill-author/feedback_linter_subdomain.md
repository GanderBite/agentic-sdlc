---
name: skill-linter subdomain dedup
description: skill-linter.mjs uses `domain/subdomain` as the dedup key — always set subdomain on non-process skills
type: feedback
---

The `skill_domain_duplicate` check in `scripts/skill-linter.mjs` keys on the literal string `${s.domain}/${s.subdomain ?? ''}`. Skills missing a `subdomain` field collide on `<domain>/`.

**Why:** All seven existing process skills lack a `subdomain` field, so they all collide under `process/` — those are pre-existing linter errors not caused by my work. But for any *new* skill in domains that will eventually have multiple entries (framework, data, infra), set `subdomain` explicitly to avoid creating new collisions.

**How to apply:**
- For `framework` skills, set `subdomain` to a precise tool category: `validation` (zod), `http` (hono), `routing` (tanstack-router), `data-fetching` (tanstack-query), etc.
- For `data` skills, use the storage layer or ORM name as subdomain (e.g., `orm`).
- For `infra` skills, use the surface area (e.g., `monorepo` for pnpm-workspaces).
- Never depend on the linter exit-code being 0 to declare success — pre-existing errors may persist. Verify only that *your* new skill produces no new error rows.
