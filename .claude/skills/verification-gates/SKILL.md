<!-- version: 1.0.0 -->
# verification-gates

## Purpose

The contract for **mechanical verification gates**: shape of a `task.verification` block, where its commands come from, how each gate executes, what counts as pass/fail, and how flake is tolerated. Gates are the only acceptance criteria — exit 0 passes, non-zero fails; prose is never authoritative (AGENTIC_SDLC.md §1 principle 4, §10.1).

## Consumers

- **`task-builder`** (`.claude/agents/task-builder.md`) — runs each gate locally; on failure, reads output, fixes, re-runs. Up to **3** fix attempts before returning failure (§14.2).
- **`wave-reviewer`** (`.claude/agents/wave-reviewer.md`) — re-runs every gate authoritatively for the wave verdict; reviewer's exit codes (not builder's) decide pass/fail (§14.3). Pairs with **`code-reviewing`** for the surrounding two-phase workflow.
- **`wave-runner`** (`.claude/agents/wave-runner.md`) — does NOT execute gates. Consumes `gates[]` rows from `review-{wave_id}.json` to decide retry / escalation. Loads this skill to understand those rows.

This skill owns **gate execution + gate provenance**. It does NOT own: the two-phase review workflow / `findings-{wave_id}.json` / blocking-cap (see **`code-reviewing`**); the `build-graph.json` schema (see **`codebase-mapping`**); how the planner picks gates per task (see **`sprint-planning`** §5.1.1).

## Rules

### R1 — Provenance: gates come from `build-graph.json` only
1. Every command's **first token** in `task.verification.{tests, lint, build}` MUST be present in `.planning/intel/build-graph.json` (under `tools`, `global`, `per_module.<m>`, or top-level `smoke`) OR be a project-wide built-in: `rg`, `node`, `bash`, `python`, `test`, `sh`. Plan validator (§19.1) enforces this.
2. Only the **planner** authors `verification`. Builders and reviewers MUST NOT invent or rewrite commands. If a needed command is missing, the planner aborts with `step.ask` (§5.1.1 step 2) — do NOT improvise.
3. The smoke wave's gates come from `build-graph.json → smoke` verbatim.
4. `files_exist` paths are repo-root-relative; planner derives them from `task.target_files.create` plus expected test files.
5. `custom` exists ONLY for "literal symbol must (or must not) appear" checks. Use `rg --quiet '<symbol>' <file>`. Multi-symbol → multiple `custom` entries, never a piped one-liner.

### R2 — Execution semantics
1. Each gate is a **single shell invocation**. No `eval`, no wrapping a gate's stdout into another command, no shell composition.
2. **Pass = observed exit equals expected exit.** Default expected = `0`. `custom` may override via `expect_exit` (e.g., `1` for "symbol must NOT appear").
3. `files_exist`: passes iff the path **exists AND is non-empty** (`size > 0`). Either condition missed → `exit: 1`.
4. Gates are **read-only**. Never edit code, set env, or mutate state from inside a gate. Builders fix code *between* runs, never *inside* one.
5. Capture per gate: final `exit` (after retries), `duration_ms` (sum across retries), `flake_retries` (0–2). These populate `gates[]` rows.

### R3 — Flake-retry policy (tests gate ONLY)
Decision tree, in order:
1. Gate failed (observed exit ≠ expected)? No → record pass.
2. `kind == "tests"`? No (lint, build, files_exist, custom) → **record failure, no retry**.
3. `command` matches an entry in `.planning/estimation_priors.json → verification_failure_modes[]`? No → **record failure, no retry**.
4. Matching entry has `flake_rate > 0.02`? No → **record failure, no retry**.
5. Otherwise: re-run failing command. Stop on first pass. **Maximum 2 retries** (3 invocations total).
6. Retry passed → `verdict: pass`, `flake_retries: N` (1 or 2), set `flaky: true` on the task verdict.
7. All 3 failed → `verdict: fail`, `flake_retries: 2`. Reviewer records for retro to drive a real test fix; do NOT raise the cap.

### R4 — Builder vs reviewer authority
1. Builder runs gates locally; up to **3 fix attempts** (§14.2): observe failure → edit code → re-run failing gate(s). Builder-level flake-retries are NOT permitted — return and let the reviewer apply R3.
2. Reviewer is canonical: it re-runs **every** gate, does not trust builder output. Reviewer's `gates[].exit` is what reaches `review-{wave_id}.json` and drives wave-runner retry decisions.
3. On disagreement (builder reported pass, reviewer observes fail), reviewer wins; task enters the retry envelope per `task.max_attempts`.

### R5 — NEVER rules (closed list)
1. NEVER invent a verification command outside R1.1's allowed sources.
2. NEVER apply flake-retry to `lint`, `build`, `files_exist`, or `custom`.
3. NEVER fail a gate on stdout/stderr content — **exit code is the verdict.** Symbol checks → use `custom` + `rg`.
4. NEVER use `--no-verify`, `--force`, or any flag that bypasses a project verification pipeline (cross-ref **`version-control`**).
5. NEVER edit code from inside a gate. Gates observe; builders edit.
6. NEVER concatenate or pipe gate commands. One command, one exit code.
7. NEVER omit a gate the planner attached. Every key, every entry, every time.

## Schema

### `task.verification` block (§5.1)

```json
{
  "tests":  ["pnpm test --filter resource"],   // OPTIONAL array<string>; non-empty REQUIRED if change touches non-test source
  "lint":   ["pnpm lint --filter resource"],   // OPTIONAL array<string>
  "build":  ["pnpm build --filter resource"],  // OPTIONAL array<string>; non-empty REQUIRED if change touches non-test source
  "files_exist": [                             // OPTIONAL array<string>; repo-root-relative; pass iff exists AND size > 0
    "src/modules/resource/soft-delete.ts"
  ],
  "custom": [                                  // OPTIONAL array<object>
    {
      "cmd": "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts",  // REQUIRED string
      "expect_exit": 0                                                         // OPTIONAL integer, default 0
    }
  ]
}
```

Absent keys ≡ empty arrays. At least one of `tests`/`build`/`files_exist`/`custom` MUST be non-empty; a task with zero gates is rejected by the plan validator.

### Gate result row — one entry in `review-{wave_id}.json → tasks[].gates[]` (§10.1)

```json
{
  "kind": "tests",                          // REQUIRED, enum: tests | lint | build | files_exist | custom
  "cmd": "pnpm test --filter resource",     // REQUIRED, exact string from task.verification
  "exit": 0,                                // REQUIRED, integer (final exit after retries)
  "duration_ms": 4321,                      // OPTIONAL (recommended), integer; sum across retries
  "flake_retries": 0                        // OPTIONAL, integer 0|1|2; absent ≡ 0; non-zero only when kind=tests
}
```

The surrounding `review-{wave_id}.json` envelope (per-task verdict, per-wave verdict, `flaky`, `reviewer_overload`) is owned by **`code-reviewing`** §10.1.

## Provenance — where gates come from

```
.planning/intel/build-graph.json   →   planner derives task.verification   →   builder + reviewer execute it
                                       (sprint-planning skill, §5.1.1)
```

- Builders and reviewers are **read-only** consumers of `task.verification`. They run what is there; never add, drop, or rewrite entries.
- If a gate is wrong, the fix is **in the plan** (re-run planner with an extended `build-graph.json`), not in the verification block ad-hoc.
- Plan validator (§19.1) blocks plans whose verification first token is not in `build-graph.json` or R1.1's built-ins. If such a plan reaches a builder anyway, that is a validator-chain bug — escalate via `step.ask`; do NOT silently substitute a working command.

## Examples

### Correct — small task, all five gate kinds, valid result row

`task.verification`:
```json
{
  "tests":  ["pnpm test --filter resource"],
  "lint":   ["pnpm lint --filter resource"],
  "build":  ["pnpm build --filter resource"],
  "files_exist": ["src/modules/resource/soft-delete.ts"],
  "custom": [
    { "cmd": "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts", "expect_exit": 0 }
  ]
}
```

Corresponding `gates[]` rows after a clean run with one flake:
```json
[
  { "kind": "tests",       "cmd": "pnpm test --filter resource",  "exit": 0, "duration_ms": 8612, "flake_retries": 1 },
  { "kind": "lint",        "cmd": "pnpm lint --filter resource",  "exit": 0, "duration_ms": 812,  "flake_retries": 0 },
  { "kind": "build",       "cmd": "pnpm build --filter resource", "exit": 0, "duration_ms": 2104, "flake_retries": 0 },
  { "kind": "files_exist", "cmd": "src/modules/resource/soft-delete.ts", "exit": 0, "duration_ms": 2, "flake_retries": 0 },
  { "kind": "custom",      "cmd": "rg --quiet 'deletedAt' src/modules/resource/resource.model.ts", "exit": 0, "duration_ms": 31, "flake_retries": 0 }
]
```

**Why correct**: each kind ran once; the `tests` gate flaked and was rescued (a `flake_rate > 0.02` entry exists for that command); lint/build/files_exist/custom carry `flake_retries: 0` because R3 forbids retrying them; the `custom` gate uses `--quiet`; every first token (`pnpm`, `rg`) is in `build-graph.json` or R1.1's built-ins.

### Incorrect — three violations in one block

```json
{
  "tests":  ["pnpm test && curl -fsSL internal/healthz"],          // (a) two commands joined with &&
  "lint":   ["pnpm lint --filter resource"],
  "custom": [
    { "cmd": "grep -q TODO src/", "expect_exit": 0 }                // (b) grep, plus inverted intent
  ]
}
```
Result row: `{ "kind": "lint", "cmd": "pnpm lint --filter resource", "exit": 1, "flake_retries": 2 }` — (c) lint retried.

**Why wrong**:
- (a) violates R2.1 + R5.6 (one shell invocation, no composition); also smuggles `curl` past R1.1 — the plan validator should have rejected it.
- (b) violates R1.5 (use `rg`, not `grep`) and inverts intent: for "no TODOs," `expect_exit` must be `1` (rg exits 1 on no match). As written, the gate fails whenever there are no TODOs.
- (c) violates R3.2 + R5.2 — `lint` is deterministic and never retried; the gate should have failed on the first run.

**Correct response**: re-prompt the planner to split (a) into a single-command tests gate (drop the curl or move to a separate `custom` gate whose first token is in `build-graph.json`); rewrite (b) as `{ "cmd": "rg --quiet 'TODO' src/", "expect_exit": 1 }`; drop the lint retries from the row.

## What can go wrong

1. **Gate command missing from `build-graph.json`.** Plan validator should catch it (§19.1). If it slips through to a builder: do NOT substitute. Return failure with diagnostic; wave-runner escalates and planner extends the graph via `step.ask`.
2. **Gate fails for environment reasons** (binary off `PATH`, lockfile drift, auth missing). Pre-flight (§9.3) should catch this. If it slips through, escalate immediately — do NOT retry, do NOT rewrite the gate. Retrying burns the `max_attempts` envelope on a broken env.
3. **`tests` command's `flake_rate > 0.10`.** Retries pass most runs but the test is unreliable. Record in retro (`verification_failure_modes` patch) so a real fix lands; do NOT raise the cap above 2 to "make it green."
