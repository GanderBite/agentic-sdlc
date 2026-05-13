---
name: MedBrige skill suite
description: 12 domain skills + 7 process skills planned for MedBrige; parallel skill-author runs are normal
type: project
---

MedBrige is a local-PoC medical record platform. The tech stack is fixed in `docs/TECH_STACK.md` (status: Definitive). 12 domain skills are scoped: typescript, pnpm-workspaces, hono, drizzle, zod, react, tanstack-router, tanstack-query, tailwind, shadcn-ui, vitest, biome. Plus 7 existing process skills.

**Why:** The user runs multiple `skill-author` invocations in parallel (one per skill). Each appends to `.claude/skills/INDEX.json` so concurrent edits + Edit-tool "file modified since read" retries are expected.

**How to apply:**
- Always re-Read INDEX.json immediately before the Edit when there's a chance other agents are running.
- Do not modify entries written by other skill-author invocations.
- After own write, do not be alarmed when the system-reminder shows additional skills appearing in the list.
- Token budget per SKILL.md: target ≤3k, hard cap 5k, measured by `Math.ceil(chars/4)`.
