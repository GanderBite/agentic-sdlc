<!-- version: 1.0.0 -->
# Common pitfalls (project-local recurrence catalogue)

Tool-agnostic patterns the planner should pre-empt and the wave-reviewer should flag. Each entry names the **category**, the **owning skill** (where the concrete fix lives), and the **plan-time mitigation** the planner applies. Cross-referenced from:

- `sprint-planning/SKILL.md` Rule 22 — every task's `description` is inspected against these patterns; matches land in `task.context.do_not_recur`.
- `.claude/agents/task-builder.md` — builders read `.planning/reviews/sprint-<id>/do-not-recur.md` on entry (built up by the wave-reviewer); the catalogue here is the cross-sprint canonical set, the do-not-recur file is the sprint-local accumulation.
- `verification-gates/SKILL.md §R7.3` — recurrence of `auto_fixable: true` findings escalates to `blocking`. Patterns here drive most of those recurrences.

The catalogue is intentionally short. Entries are added only when a pattern has been observed in ≥2 prior sprints' findings AND has a concrete plan-time mitigation. Otherwise the pattern stays in the per-skill `## Common pitfalls` sections.

## Categories

### CP-1 — Module-system import-extension drift (TS5097)

- **Owning skill:** `typescript` (see Module-system convention).
- **Pattern:** Relative imports in `.ts` source use the source extension (`.ts` / `.tsx`) or omit the extension. Under NodeNext, `tsc` errors with TS5097.
- **Why this catalogue:** Recurred in 7/10 waves of sprint-001 with `auto_fixable: true` ignored 3× — the single highest-cost recurrence.
- **Plan-time mitigation:** Any task that creates a new `.ts` / `.tsx` file in `apps/api/src/**` or `packages/contracts/src/**` MUST load the `typescript` skill in `task.skills` (so the Builder protocol catches it). Mention "import extensions: `.js` per NodeNext" in `task.context.do_not_recur`.
- **Builder mitigation:** The `typescript` skill's Builder protocol scans `${TARGET_FILES}` for relative imports ending in `.ts` / `.tsx` and fails the task before gates run.

### CP-2 — Eager singletons bypass DI seams

- **Owning skill:** `typescript` + `drizzle` (the DB instance is the canonical offender).
- **Pattern:** Module-top-level `export const db = drizzle(pool, ...)` (or env, logger, token-store equivalent) evaluated at import time. Test code cannot substitute a fake. Reviewer flags `eager_singleton`; same finding recurred 9× across 6 waves in sprint-001.
- **Plan-time mitigation:** When a task creates or modifies a "shared infrastructure" file (`apps/api/src/shared/db.ts`, `env.ts`, `logger.ts`, `tokens.ts`), the planner adds `task.context.do_not_recur` line: "Export a factory (`make<Name>(deps)`) or lazy accessor; never a top-level singleton evaluated at module load."
- **Builder mitigation:** The Builder protocol in `typescript` does not detect this automatically (it requires structural understanding). The wave-reviewer's `code-reviewing` skill enumerates the pattern as a recurring check.

### CP-3 — Lint / format / build gate scoped repo-wide on a package-scoped task

- **Owning skill:** `biome` + `pnpm` (concrete commands); `verification-gates §R9` (generic rule).
- **Pattern:** A plan emits `pnpm -r lint` or `biome check apps packages` as a wave gate when only a single package's files were touched. Lint diagnostics from unrelated files leak into the wave's findings (55-error finding in sprint-001's smoke wave).
- **Plan-time mitigation:** Rule 21 (R4d) of `sprint-planning/SKILL.md` is the enforcement. The planner's gate-scope derivation MUST match `task.target_files`'s package union.
- **Reviewer mitigation:** `gate_scope_drift` finding (severity `high`, NOT `auto_fixable`) raised against the plan file when observed diagnostics span files outside the wave's diff.

### CP-4 — `target_files` insufficient for the acceptance criteria

- **Owning skill:** `sprint-planning` (Rule 20 / R4b).
- **Pattern:** Acceptance bullets mention an identifier (`findUserById`, `revokeAllActiveForUser`, …) but the file that would define that identifier is not in any task's `target_files`. Builder must either go out-of-scope (recorded as a scope-drift finding) or short-circuit with a partial verdict (sprint-001 `task-auth-service` wave-7 block).
- **Plan-time mitigation:** Rule 20 cross-check before emitting `tasks.json`. Every acceptance-bullet identifier MUST have its defining file present in some `target_files` entry.

### CP-5 — Hard-coded secret defaults committed (e.g. `"change-me"`)

- **Owning skill:** `docker-compose` + `hono` (env wiring).
- **Pattern:** Compose service or env loader carries `password=change-me` / `JWT_SECRET=change-me` as a default. Ships to source control. Security regression observed in sprint-001 wave-7 findings.
- **Plan-time mitigation:** Any task touching `docker-compose.yml`, `.env*`, or `apps/api/src/shared/env.ts` gets `task.context.do_not_recur`: "Refuse to start without the env var (`process.env.X ?? throw`); never commit a placeholder default for any secret-typed key."
- **Reviewer mitigation:** `code-reviewing` security category flags the pattern; the catalogue here ensures the planner pre-warns the builder.

### CP-6 — `auto_fixable: true` findings deferred without a fixer dispatch

- **Owning skill:** `verification-gates §R7` (general); per-skill Builder protocols (specific).
- **Pattern:** The reviewer marks a finding `auto_fixable: true` but it carries forward into the next iteration because the fixer-dispatch rule used to gate on `severity == "blocking"`. 8/8 such findings carried forward in sprint-001.
- **Resolution:** Mechanism fix lands in `prompts/05_fix_findings.md` (R3) — dispatch fixers for ALL `auto_fixable: true` findings regardless of severity. Plan-time mitigation: none required (this is a flow-mechanic fix); listed here for traceability so future planners don't reintroduce the "blocking only" assumption.

## How the catalogue grows

When the retro for a sprint identifies a new recurring pattern, add an entry here under the next `CP-N` index ONLY IF:

- The pattern recurred across waves in at least 2 sprints, OR
- The pattern recurred ≥5 times within a single sprint with `auto_fixable: true` carry-forward, AND
- There is a concrete plan-time mitigation (a planner can DO something with the entry).

Patterns that fail this test stay in the relevant per-skill `## Common pitfalls` section. The catalogue here is not a wish-list — it is the project-wide do-not-recur ground truth that drives Rule 22.
