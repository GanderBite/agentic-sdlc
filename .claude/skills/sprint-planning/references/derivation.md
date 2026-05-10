# Derivation deep-dive

A worked walkthrough of the §5.1.1 task-derivation recipe plus edge cases that frequently produce broken plans. The seven-step recipe in `SKILL.md` is normative; this file shows how to apply it without ambiguity.

## Worked example: deriving one task

**Brief excerpt:** "Add soft-delete to `Resource`. Soft-deleted resources must not appear in list queries. Hard-delete remains for admins only."

**INTEL inputs:**

- `modules.json`: `resource` module at `src/modules/resource/`, depends on `common` and `auth`, test path `src/modules/resource/__tests__`.
- `hot-files.md`: `src/modules/resource/index.ts` is touched in 22% of recent commits.
- `build-graph.json`: has `per_module.resource.{test,lint,build}` and `global.{test,lint,build,typecheck}` and `smoke = ["pnpm test","pnpm build","pnpm lint"]`.
- `INDEX.json`: contains `typescript`, `prisma`, `nestjs`, `vitest`, …

### Step 1 — `target_files`

The change touches the model (column add), the service (filter logic + soft-delete method), and adds a small helper. The index is hot.

```json
{
  "create": ["src/modules/resource/soft-delete.ts"],
  "update": ["src/modules/resource/resource.model.ts",
             "src/modules/resource/resource.service.ts"],
  "remove": [],
  "may_also_touch": ["src/modules/resource/index.ts"]
}
```

`index.ts` goes to `may_also_touch` because it is a hot file AND the new helper will need a re-export — but the re-export is not the *deliverable*. If two tasks plausibly co-edit it, only `may_also_touch` keeps wave invariant 2 satisfiable.

### Step 2 — `verification`

The change is module-local, so use `per_module.resource.*`. Non-test source is touched, so `build` is required. The `deletedAt` symbol must literally appear in the model file, justifying a `custom` gate.

```json
{
  "tests":  ["pnpm test --filter resource"],
  "lint":   ["pnpm lint --filter resource"],
  "build":  ["pnpm build --filter resource"],
  "files_exist": ["src/modules/resource/soft-delete.ts"],
  "custom": [
    { "cmd": "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts",
      "expect_exit": 0 }
  ]
}
```

If `per_module.resource.test` did not exist in `build-graph.json`, the planner would NOT silently fall back to `global.test`. It would abort with a `step.ask` requesting the human extend the graph. Module granularity matters for wave parallelism.

### Step 3 — `skills`

Match by domain:

- Language: `typescript` (1)
- Framework: `nestjs` (1)
- Data: `prisma` (1, because the model column is a Prisma schema change)

Total: 3. Cap is 4. Vitest is not added — we already have full coverage and the cap is precious.

### Step 4 — `model`

The task touches 3 files (≤5), no new architecture, no security boundary. Not a rename or doc-only. → **`sonnet`**.

If the same change ALSO required redesigning the deletion strategy across modules → `opus`.
If it were just renaming `deleted` → `deletedAt` → `haiku`.

### Step 5 — `estimate_tokens`

See `estimation.md` for the worked numeric example. With trusted priors `~23000`; cold-start `~18000`. Document the multiplier chain in the task's `description` or in a sibling `estimation_trace.json` if your project keeps one.

### Step 6 — `depends_on`

Static analysis: does this task import a symbol produced by another task in this sprint?

- `audit-log` task (separately planned) creates `src/modules/audit/audit-log.ts` and the soft-delete service will *call* `auditLog.record(...)`. Therefore `soft-delete` depends on `audit-log`.

→ `depends_on: ["task-audit-log"]`.

If no such cross-task import exists, `depends_on: []`. Do NOT add dependencies for "logical sequencing" that isn't grounded in code.

### Step 7 — `depends_on_contracts`

The §5.4 gate:

1. ≥3 tasks share the interface? In this sprint, only one task uses the audit-log interface → **fail**.
2. Non-trivial AND net-new? Probably yes.
3. Wrong shape forces ≥2 rework? No, only 1 task at risk.

Gate fails (need ALL three). → `depends_on_contracts: []`. No contract wave.

This is the common case. Most v1 sprints will have zero contract waves. If you find yourself repeatedly emitting them, recheck the gate — over-contracting before implementation pulls interfaces is a classic waterfall failure.

## Edge cases

### EC1 — A file genuinely needs to be edited by two tasks

If two tasks both *must* deterministically edit the same file (not just a re-export), wave invariant 2 forbids putting them in the same wave.

**Resolution priority:**

1. Split into two waves with a `depends_on` edge between the tasks. Easiest, costs latency.
2. Combine the two tasks into one task. Use this when the edits are intertwined enough that splitting would create a meaningless boundary.
3. NEVER demote one to `may_also_touch` unless the second task's edit is genuinely incidental (a re-export, an import line). `may_also_touch` is a planner-blessed list of *non-deliverable* touches.

### EC2 — The brief asks for something the build graph cannot verify

Examples: "must be performant", "should be intuitive", "follows REST best practices."

These are not mechanically verifiable. Two paths:

1. Translate to a mechanical check: "performant" → a test asserting p95 latency under N ms; add the test framework to `build-graph.json` if missing.
2. If no mechanical check is possible, escalate via `step.ask` — the brief is under-specified for the v1 SDLC.

NEVER paper over with a prose check. If verification can't catch regressions, the task can't drive a deterministic loop.

### EC3 — Ambiguous module boundary

If `target_files` straddles two modules, ask:

- Does the change conceptually belong to one module that imports the other? Then it belongs to that module's wave; the cross-module read is fine.
- Does it create new coupling between modules? Surface this in `coverage_report` as an architecture concern; consider a `step.ask`.

The planner does not silently introduce cross-module coupling.

### EC4 — A task naturally wants >4 skills

Cap is 4 per §16.1 (deferred: multi-skill blending). Resolutions:

1. Split the task. Usually a 5+-skill task is doing two jobs.
2. Drop the least-leveraged skill. A skill that contributes <10% of the change is cargo-cult.

Never bypass the cap.

### EC5 — Hot file is the *primary* target

If a hot file is the genuine deliverable target (the change itself modifies it deterministically), put it in `target_files.update`. Hot-file demotion is a heuristic, not a rule. The §11.3 hints catch the common mistake; if a hint pattern matches your case, demote.

### EC6 — The smoke wave has no module-local context

The smoke wave runs `build-graph.smoke[*]` (top-level array, NOT under `global`). It needs no skills (they would only consume tokens). `estimate_tokens: 3000` is a flat budget for reading verification output. The task ID is conventionally `task-smoke` and the wave ID `wave-smoke` for grep-ability across sprints.

### EC7 — `on_fail: skip` on a non-optional task

The validator rejects this. To use `skip`, set `optional: true` on the task explicitly. This is intentional — `skip` is a sharp tool that silently drops work. The two-field requirement forces deliberation.

## Quick checklist before emitting `tasks.json`

For each task:

- [ ] `target_files` is the smallest plausible set; hot files in `may_also_touch`.
- [ ] Every `verification` command's first token resolves in `build-graph.json` (or is a known built-in like `rg`, `node`).
- [ ] `skills.length ≤ 4`; every name in `INDEX.json`.
- [ ] `model` chosen by the deterministic rule, not by feel.
- [ ] `estimate_tokens` documented (trace the multiplier chain).
- [ ] `depends_on` justified by static import analysis.
- [ ] `depends_on_contracts` empty unless ALL three §5.4 conditions hold.
- [ ] `on_fail: skip` only with `optional: true`.

For the sprint:

- [ ] Last wave is `wave-smoke` (`kind: review`, `task-smoke`, runs `build-graph.smoke`).
- [ ] Every wave passes invariants 1–5.
- [ ] No `depends_on` cycle.
- [ ] Σ tokens per sprint ≤ `orchestrator_token_budget` *if* the orchestrator overhead grows with wave count; otherwise split the sprint.
- [ ] `coverage_report.uncovered == []`.
- [ ] All enforced `wave_invariant_hints` satisfied.

A plan that ticks every box passes `scripts/validate-plan.mjs` (§19.1) on the first try.
