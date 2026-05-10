# Full annotated schemas

Complete reference shapes for `Task`, `Wave`, `Sprint`, contract artifacts, and the coverage report. Every field is annotated with required/optional status, type, and the exhaustive enum values where applicable.

## Task — full example, every field populated

```json
{
  "id": "task-7f2a",                       // (R) string, unique within sprint
  "title": "Add soft-delete to Resource model",
                                            // (R) ≤80 chars
  "description": "Add a deletedAt timestamp column to Resource. Update findAll/findOne to filter out soft-deleted rows. Expose a soft-delete method on the service. Tests must cover: (a) deletion sets deletedAt, (b) deleted rows hidden in list queries, (c) hard-delete still works.",
                                            // (R) prose; the builder reads this
  "context": [                              // (R) section refs into INTEL/ARCH/PRD
    "INTEL.md §Modules/resource",
    "ARCHITECTURE.md §Deletion strategy"
  ],
  "references": [                           // (O) files the builder Reads first
    "src/modules/resource/resource.model.ts",
    "src/modules/resource/resource.service.ts",
    "docs/ARCHITECTURE.md"
  ],
  "target_files": {                         // (R) advisory expected scope
    "create": ["src/modules/resource/soft-delete.ts"],
    "update": ["src/modules/resource/resource.service.ts",
               "src/modules/resource/resource.model.ts"],
    "remove": [],
    "may_also_touch": ["src/modules/resource/index.ts"]
                                            // index re-export, hot file: planner-blessed
  },
  "verification": {                         // (R) commands ALL come from build-graph.json
    "tests":  ["pnpm test --filter resource"],
    "lint":   ["pnpm lint --filter resource"],
    "build":  ["pnpm build --filter resource"],
    "files_exist": ["src/modules/resource/soft-delete.ts"],
    "custom": [
      { "cmd": "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts",
        "expect_exit": 0 }
    ]
  },
  "skills": ["typescript", "prisma"],       // (R) ≤4, all in INDEX.json
  "model": "sonnet",                        // (R) opus|sonnet|haiku
  "estimate_tokens": 18000,                 // (R) integer, see estimation.md
  "kind": "extend_module",                  // (O) for kind_multipliers lookup
  "depends_on": ["task-3e8d"],              // (R) IDs of prior tasks
  "depends_on_contracts": [],               // (R) usually [] in v1
  "max_attempts": 2,                        // (R)
  "on_fail": "escalate",                    // (R) retry|escalate|skip
  "optional": false,                        // (O) gate for on_fail:skip
  "status": "todo",                         // (R) todo|in_progress|done|blocked|skipped
  "attempts": [                             // (O) runtime log; planner emits []
    {
      "attempt_n": 1,
      "started_at": "2026-05-10T11:14:32Z",
      "ended_at":   "2026-05-10T11:24:05Z",
      "result": "fail",                     // pass|fail|partial
      "agent_id": "builder-2",
      "summary": "Tests failed: list query still returns deleted rows.",
      "tokens_used": 19200,
      "files_touched": ["src/modules/resource/resource.service.ts",
                        "src/modules/resource/soft-delete.ts"]
    }
  ],
  "actuals": {                              // (O) filled at sprint end
    "tokens_used": 24300,
    "wall_clock_ms": 723000,
    "files_touched": ["src/modules/resource/resource.service.ts",
                      "src/modules/resource/soft-delete.ts",
                      "src/modules/resource/resource.model.ts",
                      "src/modules/resource/index.ts"],
    "verification_results": [
      { "kind": "tests", "cmd": "pnpm test --filter resource", "exit": 0,
        "duration_ms": 4321, "flake_retries": 0 },
      { "kind": "lint",  "cmd": "pnpm lint --filter resource", "exit": 0 },
      { "kind": "build", "cmd": "pnpm build --filter resource", "exit": 0 }
    ]
  }
}
```

### Field-by-field cheatsheet

| Field | Required | Type | Enum / range |
|---|---|---|---|
| `id` | R | string | unique within sprint |
| `title` | R | string | ≤80 chars |
| `description` | R | string | prose |
| `context` | R | string[] | INTEL/ARCH/PRD section refs |
| `references` | O | path[] | files the builder Reads |
| `target_files.create` | R | path[] | may be `[]` |
| `target_files.update` | R | path[] | may be `[]` |
| `target_files.remove` | R | path[] | may be `[]` |
| `target_files.may_also_touch` | R | path[] | excluded from disjointness |
| `verification.tests` | O | cmd[] | from `build-graph` |
| `verification.lint` | O | cmd[] | from `build-graph` |
| `verification.build` | O | cmd[] | from `build-graph` |
| `verification.files_exist` | O | path[] | |
| `verification.custom` | O | `{cmd,expect_exit}[]` | `rg --quiet …` style |
| `skills` | R | string[] | ≤4, all in `INDEX.json` |
| `model` | R | enum | `opus` \| `sonnet` \| `haiku` |
| `estimate_tokens` | R | int | `>0` |
| `kind` | O | enum | `new_module` \| `extend_module` \| `rename` \| `test_only` |
| `depends_on` | R | task-id[] | acyclic |
| `depends_on_contracts` | R | name[] | satisfied by earlier wave |
| `max_attempts` | R | int | typically 2 |
| `on_fail` | R | enum | `retry` \| `escalate` \| `skip` |
| `optional` | O | bool | required `true` for `skip` |
| `status` | R | enum | `todo` \| `in_progress` \| `done` \| `blocked` \| `skipped` |
| `attempts` | O | object[] | runtime; planner emits `[]` |
| `actuals` | O | object | runtime; `null` at plan time |

## Wave — full example

```json
{
  "id": "wave-3",                           // (R) unique within sprint
  "kind": "build",                          // (R) build|contract|review|integration
  "tasks": ["task-7f2a", "task-9c1b"],     // (R) task IDs in this wave
  "token_budget": 200000,                   // (R) ≥ Σ estimate_tokens
  "max_parallelism": 4,                     // (R) ≥ 1
  "status": "todo"                          // (R) todo|in_progress|done|blocked
}
```

### Wave kinds

- `build` — N parallel builder Tasks, then a reviewer pass.
- `contract` — emits frozen interface artifacts under `.planning/sprints/<sprint>/contracts/`. Used only when §5.4's three-condition gate fires.
- `review` — exactly one task; invokes the reviewer agent. The smoke wave is one of these.
- `integration` — cross-module integration work that cannot be expressed as a `build` because target_files invariants would force serialization. Use sparingly.

## Sprint — full example

```json
{
  "id": "sprint-001",                       // (R) reserved by scripts/reserve-sprint-id.sh
  "title": "Resource soft-delete + audit log",
  "feature_brief": ".planning/features/FEATURE-resource-deletion.md",
  "branch": "sprint/001-resource-soft-delete",
  "waves": ["wave-1", "wave-2", "wave-3", "wave-smoke"],
                                            // (R) ordered; LAST MUST be smoke
  "orchestrator_token_budget": 150000,      // (R) §15.1 default
  "status": "todo",                         // todo|in_progress|done|blocked
  "created_at": "2026-05-10T09:00:00Z",
  "started_at": null,
  "completed_at": null
}
```

If the orchestrator would need to track too many concurrent waves to fit in `orchestrator_token_budget`, split the work into multiple sprints.

## Contract artifact (§5.4) — only when gate fires

Emit when ALL three hold:

1. ≥3 tasks in the next wave depend on the same shared interface.
2. The interface is non-trivial (≥2 fields or ≥1 method) AND net-new (not "extend an existing type").
3. A wrong shape would force ≥2 of those tasks to redo work.

Layout:

```
.planning/sprints/sprint-001/contracts/contract-<name>/
  contract.md          # rationale, expected behavior — human-readable
  types.ts             # frozen TypeScript interfaces (or schema.prisma, openapi.yaml)
  fixtures.json        # optional example payloads
```

A contract is immutable for the sprint duration. Wrong contract mid-execution → fail dependent wave, planner re-plans contract + dependents (§9 row "Contract turns out wrong").

## Coverage report — emitted alongside sprint files

```json
{
  "sprint_id": "sprint-001",
  "feature_brief": ".planning/features/FEATURE-resource-deletion.md",
  "acceptance_coverage": [
    {
      "bullet": "Resource can be soft-deleted via DELETE /resource/:id",
      "tasks": ["task-7f2a", "task-9c1b"],
      "verifications": [
        "pnpm test --filter resource",
        "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts"
      ]
    }
  ],
  "uncovered": []                          // MUST be empty for plan to validate
}
```

If `uncovered` is non-empty, the planning flow's `verify-coverage` step (§7.2) aborts before sprint files are written.

## Cross-references

- Wave invariants — see SKILL.md §"Wave invariants" and §5.2 of the doc.
- Estimation — see [`estimation.md`](estimation.md) and §15.
- Plan validator checks — see §19.1 of the doc.
- Contract gate conditions — see §5.4 of the doc.
