<!-- version: 1.0.0 -->
# code-reviewing

## Purpose

Two-phase review contract for one wave. **Phase 1 (mechanical)**: run every command in each task's `verification` block; emit `review-{wave_id}.json`. **Phase 2 (audit)**: read changed files; apply skill checks + ARCHITECTURE.md layering + scope drift; emit `findings-{wave_id}.json`. Both outputs are JSON. Prose is forbidden — it cannot drive a deterministic loop (AGENTIC_SDLC.md §10.3).

## Consumers

- **`wave-reviewer`** (`.claude/agents/wave-reviewer.md`) — the only loader. Receives wave JSON + `changed_files`, runs both phases, writes the two JSON files. Outputs are validated by `scripts/validate-review.mjs` and consumed by `wave-runner` (§14.1) for retry / escalation / smoke gating.

Boundary: this skill defines **review**. Construction of `task.verification` is owned by **`verification-gates`** (loaded by the builder). The reviewer only **executes** the planner's `verification` block; never invents or extends it.

## Rules

### R1 — Read-only and total
1. Inputs: `sprint_id`, `wave_id`, wave JSON (full task objects), `changed_files`, plus access to `.planning/estimation_priors.json`, `docs/ARCHITECTURE.md`, and your loaded skills.
2. Permitted tools: `Read`, `Bash`, `Glob`, `Grep`, plus `Write` only for the two JSON outputs (or `Bash` heredoc if `Write` is not in your allowlist). Never edit code.
3. Never invent verification commands. Run only the literal strings in `task.verification`.
4. Every todo task gets every gate run. No skipping.

### R2 — Phase 1 is mechanical
1. For each task, walk `task.verification` keys (`tests`, `lint`, `build`, `files_exist`, `custom`; skip absent) and run each entry via `Bash`. Capture `exit` and `duration_ms`.
2. `files_exist` passes iff every path resolves (use `test -e`). `custom` is `{cmd, expect_exit}`; passes iff observed exit equals `expect_exit`.
3. Task verdict = `pass` iff every gate's final exit matches expectation (after R3 retries). Else `fail`.
4. Wave verdict (top-level of `review-{wave_id}.json`) = `pass` iff every task verdict is `pass`. Else `fail`. Reserve `reviewer_overload` for R5.3 / R8.3.

### R3 — Flake-retry policy (tests gate only)
1. Read `.planning/estimation_priors.json → verification_failure_modes[]`. Match the failing command's literal string.
2. Retry **only if** gate `kind == "tests"` AND a matched entry has `flake_rate > 0.02`. No matching entry → no retries (record the failure as final).
3. Lint, build, files_exist, custom are deterministic — **never** retry them.
4. Maximum **2** retries per command. Record total in `gates[].flake_retries` (0|1|2). `duration_ms` = sum across attempts.
5. If a retry passes, gate verdict is `pass`; set `flaky: true` on the task object.

### R4 — Phase 2 is structured findings
1. For every file in `changed_files`: `Read` it. Apply checks from each loaded skill (security, architecture, performance, duplication, style).
2. **Scope drift**: any changed file outside the union of `task.target_files.{create, update, may_also_touch}` for its owning task → emit one `severity: "info"`, `category: "architecture"` finding. Never revert (v1 §16.1).
3. **Layering**: cross-check imports against `docs/ARCHITECTURE.md`. Hard-boundary violation = `blocking`. Soft = `high`. See `references/severity-rubric.md`.
4. If `ARCHITECTURE.md` is missing, skip R4.3 and emit one `info`/`architecture` finding `architecture_doc_missing`.
5. If a changed file is unreadable, emit one `low`/`style` finding and continue.

### R5 — Severity and category are exhaustive closed sets; blocking is capped
1. `severity` ∈ **`blocking` | `high` | `medium` | `low` | `info`**.
2. `category` ∈ **`security` | `architecture` | `performance` | `duplication` | `style`**.
3. **Hard cap: ≤5 `blocking` findings per wave.** A 6th means triage: demote less-severe to `high`, OR set wave verdict to `reviewer_overload` (R8). When in doubt, choose `high` — under-calling is recoverable.
4. Per-category severity rubric (when X becomes blocking vs high vs medium vs low) lives in `references/severity-rubric.md`. Consult before assigning.

### R6 — Required finding fields (all 8 mandatory)
- `id` — `F-NNN`, monotonic per wave from `F-001`.
- `severity`, `category` — R5 enums.
- `file` — repo-root-relative; MUST exist (validator rechecks).
- `line` — 1-based int, ≤ file line count. Use `1` for whole-file findings.
- `summary` — ≤140 chars, single sentence; no "consider" / "maybe".
- `suggested_fix` — concrete, ≤280 chars; name file/symbol/snippet.
- `auto_fixable` — `true` iff fix is mechanical (replace literal X with Y, add missing import, add null-check on a known field) AND verifiable by the existing `task.verification`. Else `false`.

### R7 — Routing contract (orchestrator-side, informational)
- `blocking` + `auto_fixable: true` → wave-runner spawns a fix builder (v1 §16.1 may defer auto-spawn; field still REQUIRED).
- `blocking` + `auto_fixable: false` → escalate via `.planning/blocked/<sprint_id>/<task_id>.md`.
- `high` / `medium` / `low` / `info` → annotated in PR body, never block.

### R8 — Wave verdict (closed set in `review-{wave_id}.json`)
1. `pass` — every task verdict is `pass`.
2. `fail` — at least one task verdict is `fail`.
3. `reviewer_overload` — you produced or would produce >5 `blocking`. Set this AND emit `findings-{wave_id}.json` with at most 5 blocking (most severe); the remainder either demoted to `high` or dropped with one `id: F-OVERFLOW`, `severity: info`, `category: architecture` summary.

The orchestrator's wave-level verdict (`pass | blocked | failed | partial` per §22) is computed by `wave-runner`, not here.

### R9 — Smoke wave (kind: review)
1. The terminal wave has `kind: "review"` and one task whose `verification` runs the full `build-graph.json → smoke` array. Run Phase 1 the same way.
2. `changed_files` spans the entire sprint. Phase 2 is the same; the 5-blocking cap still applies.
3. A green smoke wave is the **only** thing that lets the sprint produce a non-blocked PR (§10.5). Do not relax gates here.

### R10 — Validator will second-guess you
`scripts/validate-review.mjs` checks schema conformance, file existence, line-in-range, blocking-cap ≤5, enum membership. Failure → re-spawned ONCE with the validator's error. Second failure escalates to a human. Don't waste the retry.

## Schemas

All fields REQUIRED unless marked OPTIONAL. Enums are closed sets (R5).

### `review-{wave_id}.json` (Phase 1, §10.1)

```json
{
  "wave_id": "wave-3",
  "tasks": [{
    "task_id": "task-7f2a",
    "gates": [{
      "kind": "tests",                      // tests|lint|build|files_exist|custom
      "cmd": "pnpm test --filter resource", // exact string from task.verification
      "exit": 0,                            // final exit, post-retries
      "duration_ms": 4321,                  // sum across retries
      "flake_retries": 0                    // 0|1|2
    }],
    "verdict": "pass",                      // pass|fail
    "flaky": false                          // OPTIONAL: true iff a retry rescued a tests gate
  }],
  "verdict": "pass"                         // pass|fail|reviewer_overload
}
```

### `findings-{wave_id}.json` (Phase 2, §10.2)

```json
{
  "wave_id": "wave-3",
  "findings": [{                            // may be empty
    "id": "F-001",                          // monotonic per wave
    "severity": "blocking",                 // blocking|high|medium|low|info
    "category": "security",                 // security|architecture|performance|duplication|style
    "file": "src/modules/resource/resource.service.ts",  // real path on disk
    "line": 142,                            // 1-based int, ≤ file line count
    "summary": "Soft-delete check missing in list query",            // ≤140 chars
    "suggested_fix": "Filter `deletedAt: null` in `findAll` where",  // ≤280 chars
    "auto_fixable": true                    // boolean
  }]
}
```

Full annotated examples (happy path, flake rescue, failure, `reviewer_overload`, smoke) live in `references/output-templates.md`.

## Procedure

**Phase 1.** For each todo task: walk `task.verification` keys; run each gate per R2; on failure apply R3 retries; compute task + wave verdict (R2.3, R2.4, R8). Write `review-{wave_id}.json`. Default path `.planning/sprints/<sprint_id>/review-{wave_id}.json` unless overridden.

**Phase 2.** `Read` every file in `changed_files`; apply each loaded skill's checks; apply R4.2–R4.5. Assign severity per `references/severity-rubric.md`. Cardinal `blocking` rule: shipping with this finding present would break a downstream wave, ship an exploitable defect, or violate a hard rule the team explicitly committed to. Looser → at most `high`. `info` = signals (scope drift, missing docs), never real bugs. Assign monotonic `id`s; verify all 8 R6 fields. If `blocking` count >5, apply R8.3. Write `findings-{wave_id}.json` next to the review file.

## Examples

### Correct — 1 task, all green, 1 `info` scope-drift finding

```json
// review-wave-1.json
{ "wave_id": "wave-1", "tasks": [{
  "task_id": "task-7f2a",
  "gates": [
    { "kind": "tests", "cmd": "pnpm test --filter resource", "exit": 0, "duration_ms": 4321, "flake_retries": 0 },
    { "kind": "lint",  "cmd": "pnpm lint --filter resource", "exit": 0, "duration_ms": 812,  "flake_retries": 0 },
    { "kind": "files_exist", "cmd": "src/modules/resource/soft-delete.ts", "exit": 0, "duration_ms": 2, "flake_retries": 0 }
  ],
  "verdict": "pass"
}], "verdict": "pass" }

// findings-wave-1.json
{ "wave_id": "wave-1", "findings": [{
  "id": "F-001", "severity": "info", "category": "architecture",
  "file": "src/shared/logger.ts", "line": 1,
  "summary": "Edited outside task target_files; not in may_also_touch",
  "suggested_fix": "Add src/shared/logger.ts to task-7f2a target_files.may_also_touch in next plan",
  "auto_fixable": false
}]}
```

**Why correct**: every gate ran; verdict matches; scope drift surfaced as `info` (not a revert per §16.1); all 8 required fields present; no blocking → no overload risk. Validator passes.

### Incorrect — 7 blocking findings, no overload handling

```json
// findings-wave-1.json — REJECTED by validator
{ "wave_id": "wave-1", "findings": [
  { "id": "F-001", "severity": "blocking", ... },
  // ... 6 more entries, total = 7 blocking
]}
// review-wave-1.json — verdict: "pass"   ← WRONG
```

**Why wrong**: violates R5.3 (>5 blocking) and R8.3 (`review.verdict` MUST be `reviewer_overload`, not `pass`). `validate-review.mjs` rejects; R10 bounces you once; you lose a turn.

**Correct response**: triage to ≤5 most-severe blocking; demote the rest to `high` or drop with one `F-OVERFLOW` `info`/`architecture` summary; set `review.verdict: "reviewer_overload"`. See `references/output-templates.md` Template 4.
