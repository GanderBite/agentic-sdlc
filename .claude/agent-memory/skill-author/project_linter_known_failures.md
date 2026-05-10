---
name: Process-domain skills currently fail the linter
description: Six existing process-domain skills collide on `process/` in skill-linter.mjs; ignore for new-skill validation.
type: project
---

`scripts/skill-linter.mjs` currently exits 1 with six `skill_domain_duplicate` errors against the `process/` bucket:

- `codebase-mapping`, `sprint-planning`, `code-reviewing`, `skill-authoring`, `version-control`, `verification-gates` all duplicate `brain-storming`'s `domain: "process"` (no subdomain on any of them).

**Why:** When the process skills were initially authored, no subdomain field was set. Later domain-skill authors (zod, drizzle, hono, react) adopted `subdomain` to avoid collisions, but the process skills were never backfilled.

**How to apply:** When you run the linter to validate a new skill, expect this baseline of six failures. Filter for *your* skill name in the output to confirm your work is clean. Do not modify the process skills as a side-effect of authoring a new domain skill — that backfill is its own task and out of scope. If the user explicitly asks you to fix the linter, propose adding `subdomain` to each process skill (e.g. `subdomain: "intel"` for `codebase-mapping`, `subdomain: "planning"` for `sprint-planning`, etc.).
