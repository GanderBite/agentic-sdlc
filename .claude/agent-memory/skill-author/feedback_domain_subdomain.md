---
name: Use subdomain to avoid framework/data collisions
description: When adding a skill to a domain with siblings, set `subdomain` in INDEX.json to avoid linter collisions.
type: feedback
---

The skill-linter (`scripts/skill-linter.mjs`) keys uniqueness on `${domain}/${subdomain ?? ''}`. Two skills sharing both fields trigger `skill_domain_duplicate` and fail the build.

Empirical pattern observed in MedBrige's INDEX.json:

- `zod` → `framework/validation`
- `react` → `framework/react`
- `drizzle` → `data/orm`
- `hono` → `api/http-framework`

**Why:** Without subdomains, every framework-domain skill collides. The first `framework`-domain skill (zod) set the precedent; later authors followed.

**How to apply:** Whenever the new skill's `domain` already appears in INDEX.json without a subdomain (or with a different one), set an explicit `subdomain` matching the canonical name of the technology (the skill name is usually the right value: `subdomain: "react"` for `name: "react"`).
