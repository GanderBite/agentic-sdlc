<!-- version: 1.0.0 -->

# sprint-planning

## Purpose

Decompose a feature brief into a deterministic plan of `tasks` → `waves` → `sprint` artifacts. Two planners following this skill on the same inputs MUST produce equivalent plans. Encodes Task/Wave/Sprint schemas, the §5.1.1 derivation recipe, wave invariants, the smoke-wave appendix rule, contract gating, the estimation formula, and validator-aligned hard constraints.

Full annotated schemas live in [`references/schemas.md`](references/schemas.md). Estimation primitives and worked numerics live in [`references/estimation.md`](references/estimation.md). Edge cases and a derivation walkthrough live in [`references/derivation.md`](references/derivation.md).

## Consumers

- `sprint-planner` (primary). Reads INTEL, `build-graph.json`, `INDEX.json`, `estimation_priors.json`; writes `tasks.json`, `waves.json`, `sprint-{id}.json`, `coverage_report`.
- `wave-runner` (secondary). Re-validates wave invariants at runtime; if intel drifted between planning and execution, aborts with `reason="invariant_violation_at_runtime"`.

## Rules

Numbered, imperative, individually verifiable. Mirrors `scripts/validate-plan.mjs` (§19.1).

1. Derive `task.verification` strictly from `build-graph.json`. NEVER invent commands. Missing command → abort with `step.ask` to extend the graph.
2. Reference skills only from `.claude/skills/INDEX.json`. NEVER name a skill not in the registry.
3. Cap `task.skills` at 4 entries.
4. Pick `task.model` per the rule in **Derivation procedure** step 4. Exhaustive enum: `opus | sonnet | haiku`.
5. Compute `task.estimate_tokens` with the formula in **Estimation formula**. Trust a multiplier only when its `n ≥ 5`; else use `1.0`.
6. Use the smallest plausible `target_files`. Hot-files (from `hot-files.md`) go to `may_also_touch`, not `target_files`.
7. Within any wave, `create ∪ update ∪ remove` MUST be pairwise disjoint across tasks. `may_also_touch` is excluded from this check.
8. Within any wave, no task appears in another task's `depends_on` (intra-wave acyclicity).
9. Σ `estimate_tokens` in a wave MUST be ≤ `wave.token_budget`.
10. Concurrent builders in a wave MUST be ≤ `wave.max_parallelism`.
11. Every `depends_on_contracts` entry MUST be produced by an earlier wave in the same sprint.
12. Every sprint MUST end with a smoke wave (see **Smoke wave**). Plan validator aborts on missing.
13. Use a contract wave ONLY when ALL three §5.4 conditions hold. Default: skip contracts.
14. The `depends_on` graph MUST be acyclic across the whole sprint.
15. Every acceptance bullet MUST map to ≥1 `task.verification` gate. Emit `coverage_report`; uncovered → abort.
16. Every enforced `wave_invariant_hints` entry (§11.3) MUST be satisfied. Re-prompt on violation.
17. NEVER set `on_fail: skip` unless the task is tagged `optional: true`.

## Schemas

Bare skeletons. Full populated examples + field-by-field cheatsheets in [`references/schemas.md`](references/schemas.md).

### Task (§5.1)

Required fields: `id, title, description, context, target_files, verification, skills, model, estimate_tokens, depends_on, depends_on_contracts, max_attempts, on_fail, status`. Optional: `references, optional, kind, attempts, actuals`.

```json
{
  "id": "task-<hash>", "title": "...", "description": "...",
  "context": ["INTEL/ARCH refs"], "references": ["path"],
  "target_files": {"create":[],"update":[],"remove":[],"may_also_touch":[]},
  "verification": {"tests":[],"lint":[],"build":[],"files_exist":[],
                   "custom":[{"cmd":"rg --quiet 'X' p","expect_exit":0}]},
  "skills": ["name"], "model": "opus|sonnet|haiku",
  "estimate_tokens": 18000, "kind": "new_module|extend_module|rename|test_only",
  "depends_on": ["task-id"], "depends_on_contracts": ["name"],
  "max_attempts": 2, "on_fail": "retry|escalate|skip", "optional": false,
  "status": "todo|in_progress|done|blocked|skipped",
  "attempts": [], "actuals": null
}
```

Exhaustive enums:
- `model`: `opus | sonnet | haiku`
- `on_fail`: `retry | escalate | skip` (`skip` requires `optional: true`)
- `status`: `todo | in_progress | done | blocked | skipped`
- `kind` (optional): `new_module | extend_module | rename | test_only`

`target_files` semantics: `create/update/remove` are advisory expected scope; the wave invariant operates on their union. `may_also_touch` is the planner-blessed list of allowed-but-not-required co-edits and is **excluded** from the disjointness check.

### Wave (§5.2)

```json
{ "id": "wave-<n>", "kind": "build|contract|review|integration",
  "tasks": ["task-id"], "token_budget": 200000, "max_parallelism": 4,
  "status": "todo|in_progress|done|blocked" }
```

Exhaustive enums:
- `kind`: `build | contract | review | integration`
- `status`: `todo | in_progress | done | blocked`

`kind: contract` → frozen interface artifacts (§5.4). `kind: review` → exactly one task; the smoke wave is one of these.

### Sprint (§5.3)

```json
{ "id": "sprint-001", "title": "...", "feature_brief": "...md",
  "branch": "sprint/001-<slug>", "waves": ["wave-id"],
  "orchestrator_token_budget": 150000,
  "status": "todo|in_progress|done|blocked",
  "created_at": "ISO-8601", "started_at": null, "completed_at": null }
```

`waves` is ordered; the LAST entry MUST be the smoke wave.

### Contract artifact (§5.4) — only when gate fires

Emit at `.planning/sprints/<sprint>/contracts/contract-<name>/{contract.md, types.ts, fixtures.json}`. Immutable for sprint duration. Wrong contract mid-execution → fail dependent wave, planner re-plans.

## Derivation procedure

Apply per task, in order. Verbatim from §5.1.1.

1. **`target_files`** — pick from feature description + `modules.json` + `hot-files.md`. Smallest plausible set. Hot-files go to `may_also_touch`.
2. **`verification`** — strictly from `build-graph.json`:
   - `tests` ← `per_module[<module>].test` if module-local, else `global.test`.
   - `lint` ← same pattern.
   - `build` ← only if non-test source touched.
   - `files_exist` ← `target_files.create` plus expected new test files.
   - `custom` ← only when a literal symbol must appear (use `rg --quiet`).
   - Missing command → abort with `step.ask`. Never invent.
3. **`skills`** — domain match: 1 language + 1 framework + (1 data, if data layer touched). Hard cap 4. All names in `INDEX.json`.
4. **`model`** — exhaustive rule:
   - `opus` if task touches `>5` files OR involves new architecture, security, or data-schema decisions.
   - `haiku` if task is a pure rename, config edit, or doc-only change with no logic.
   - `sonnet` otherwise (the common case).
5. **`estimate_tokens`** — apply the formula in **Estimation formula**.
6. **`depends_on`** — by static analysis: if A creates a file B imports/updates, B depends on A.
7. **`depends_on_contracts`** — only if §5.4's three-condition gate fires.

After all tasks are derived: group into waves (rules 7–11), append the smoke wave, partition into sprints by `orchestrator_token_budget`, run coverage check (rule 15).

## Wave invariants

Numbered for direct mapping to validator output:

1. Intra-wave acyclicity — no task depends on another task in the same wave.
2. `target_files` disjointness across `create ∪ update ∪ remove` (excludes `may_also_touch`).
3. `Σ estimate_tokens ≤ token_budget`.
4. Concurrent builders ≤ `max_parallelism`.
5. All `depends_on_contracts` satisfied by an earlier wave in the sprint.

If any invariant fails during planning, revise wave composition; do not relax the rule.

## Smoke wave (§10.5) — mandatory final wave

Every sprint MUST end with this exact shape. Plan validator (§19.1) aborts if missing.

```json
{
  "id": "wave-smoke",
  "kind": "review",
  "tasks": [{
    "id": "task-smoke",
    "title": "Smoke verification",
    "verification": {
      "tests": ["<cmds from build-graph.smoke[*]>"],
      "lint":  ["<cmds from build-graph.smoke[*]>"],
      "build": ["<cmds from build-graph.smoke[*]>"],
      "custom": []
    },
    "skills": [],
    "estimate_tokens": 3000,
    "model": "sonnet",
    "max_attempts": 2,
    "on_fail": "escalate",
    "depends_on": [],
    "depends_on_contracts": [],
    "target_files": {"create":[],"update":[],"remove":[],"may_also_touch":[]},
    "status": "todo"
  }]
}
```

Commands come from the **top-level** `build-graph.smoke` array (per §4.1, smoke is top-level, NOT nested under `global`). A green smoke wave is the only thing that lets the sprint produce a non-blocked PR.

## Estimation formula

```
final_estimate = base_estimate
                 × geomean(skill_multipliers[s] for s in task.skills)
                 × model_multipliers[task.model]
                 × kind_multipliers[task.kind]
```

`mean_ratio = actual_tokens / estimated_tokens`. Trust a multiplier ONLY when `n ≥ 5`; else substitute `1.0`. Cold-start primitives, default budgets (§15.1), and a worked numeric example are in [`references/estimation.md`](references/estimation.md).

The planner READS `estimation_priors.json`. It NEVER writes it. Updates flow through `priors-patch.json` → `scripts/merge-priors.mjs`.

## Examples

### Correct: 3-wave sprint with disjoint `target_files`

Wave-1 has two parallel tasks that both list `src/index.ts` only in `may_also_touch` (excluded from disjointness):

```json
"wave-1": {"kind":"build","max_parallelism":2,"token_budget":200000,"tasks":[
  {"id":"task-a1","target_files":{"create":["src/soft-delete.ts"],"update":[],"remove":[],"may_also_touch":["src/index.ts"]},"depends_on":[],"estimate_tokens":18000},
  {"id":"task-a2","target_files":{"create":[],"update":["src/audit.ts"],"remove":[],"may_also_touch":["src/index.ts"]},"depends_on":[],"estimate_tokens":12000}
]}
```

Wave-2 has a single task depending on `task-a1` (cross-wave dep, fine). Final wave is `wave-smoke` (`kind: review`, single `task-smoke`, runs `build-graph.smoke`). VALID.

### Incorrect: `target_files` conflict inside a wave

```json
"wave-1": {"kind":"build","tasks":[
  {"id":"task-x","target_files":{"update":["src/service.ts"],"create":[],"remove":[],"may_also_touch":[]}},
  {"id":"task-y","target_files":{"update":["src/service.ts"],"create":[],"remove":[],"may_also_touch":[]}}
]}
```

WHY INVALID: both tasks list `src/service.ts` under `update`, violating wave invariant 2. Fix by serializing into separate waves with a `depends_on` edge, OR combining into one task. Do NOT demote to `may_also_touch` when both tasks deterministically edit the file. See [`references/derivation.md`](references/derivation.md) §EC1.

## NEVER

- NEVER invent verification commands not in `build-graph.json`.
- NEVER reference skills not in `INDEX.json`.
- NEVER produce a sprint with `target_files` conflicts within any wave.
- NEVER skip the smoke wave.
- NEVER use contracts unless §5.4's three-condition gate fires.
- NEVER trust a multiplier when its `n < 5` — fall back to `1.0`.
- NEVER set `on_fail: skip` on a non-`optional` task.
- NEVER write `estimation_priors.json` directly — emit a patch.
