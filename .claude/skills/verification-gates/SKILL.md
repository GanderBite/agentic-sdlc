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
1. NEVER invent a verification command outside R1.1's allowed sources (but see R6.2 — skills may publish gates via a `Verification recipe` section).
2. NEVER apply flake-retry to `lint`, `build`, `files_exist`, or `custom`.
3. NEVER fail a gate on stdout/stderr content — **exit code is the verdict.** Symbol checks → use `custom` + `rg`.
4. NEVER use `--no-verify`, `--force`, or any flag that bypasses a project verification pipeline (cross-ref **`version-control`**).
5. NEVER edit code from inside a gate. Gates observe; builders edit.
6. NEVER concatenate or pipe gate commands. One command, one exit code.
7. NEVER omit a gate the planner attached. Every key, every entry, every time.

### R6 — Builder protocol (pre-gate write step owned by each skill)

This is the contract that closes the "builders never auto-fix; the gate only audits" gap (G1 of the sprint-001 postmortem). It is tool-agnostic by design: this skill defines the **shape and execution semantics**; each tool skill owns its concrete commands inside a `## Builder protocol` section of its `SKILL.md`.

1. **Shape of a skill's `## Builder protocol` section.** A fenced `sh` (or `bash`) code block whose body is a sequence of shell statements. The block MAY reference `${TARGET_FILES}` — the builder substitutes a space-separated list of repo-relative paths drawn from `task.target_files.{create,update,may_also_touch}`, restricted to files the protocol's tool understands (a TS protocol filters to `*.ts`/`*.tsx`; a JSON-manifest protocol filters to `package.json`/`pnpm-workspace.yaml`; etc.). If the substitution is empty, the protocol skips silently — the resulting `xargs`/`for` loops MUST tolerate empty input.
2. **Promotion of a skill's `## Verification recipe`.** Each skill MAY publish a `## Verification recipe` section listing gates the planner is allowed to append to any task whose `skills` array references that skill. These bypass R1.1's "first token must be in `build-graph.json`" check only because the recipe author has guaranteed the first token IS in `build-graph.json → tools` (every published recipe's first token is `pnpm`, `node`, `bash`, `rg`, or an entry in `tools`). The planner reads the recipe and merges it into `task.verification` per `sprint-planning §R4c`.
3. **Execution semantics — when builders run protocols.** Builders run every loaded skill's `## Builder protocol` AFTER edits and BEFORE `task.verification` executes. The contract for the builder is in `task-builder.md` ("WORK → BUILDER PROTOCOL → VERIFICATION LOOP"). A non-zero exit from any protocol aborts the task with `verdict: "fail"` and a diagnostic naming the offending skill — the verification gates DO NOT run in that case (no point auditing code that the skill already says is malformed).
4. **Idempotency.** Protocols MUST be safe to re-run. The builder re-runs every protocol after each fix iteration — protocols that mutate the working tree (formatter writes, lockfile sync) must converge to a fixed point.
5. **Scope discipline.** Protocols MUST scope to `${TARGET_FILES}`. A protocol that runs `pnpm -r lint` or `tsc -b` repo-wide is a §R4d violation — the reviewer rejects the wave.
6. **Tool-name confinement.** Tool-specific commands (`biome`, `pnpm`, `vitest`, `drizzle-kit`, ...) appear ONLY inside skill `## Builder protocol` and `## Verification recipe` sections. `.claude/agents/*` and `verification-gates/SKILL.md` itself remain toolchain-agnostic.

### R7 — Auto-fixable findings (severity-independent mandatory-fix)

This is the contract that closes G3 of the postmortem (8/8 `auto_fixable: true` findings carried forward unhealed).

1. **Wave-reviewer semantics.** When the reviewer marks a finding `auto_fixable: true`, this is a **promise** that a fixer Task scoped to the finding's file can resolve the issue in ≤1 iteration without judgment.
2. **Dispatch rule.** The `review-fix-loop`'s fixer-dispatch step (`prompts/05_fix_findings.md`) MUST dispatch a fixer for EVERY finding with `auto_fixable: true`, regardless of severity (`blocking`, `high`, `medium`, `low`). The "only blocking+auto_fixable" semantics of `wave-runner §Step 8` is the OLD behavior — it is superseded by this rule.
3. **Escalation rule.** If the same `auto_fixable: true` finding appears in iteration N+1 after a fixer was dispatched in iteration N, the wave-reviewer MUST upgrade its severity to `blocking` on the second occurrence. Cited reason: the fixer either failed silently or the underlying skill's `Builder protocol` does not actually cover the case — both are project bugs, not finding noise.
4. **Bookkeeping.** The reviewer records per-finding `first_seen_iteration` so the escalation rule (R7.3) is decidable.

### R8 — Gate replay after the review-fix-loop iterates

This is the contract that closes G2 of the postmortem (the loop iterates on findings, not on gates).

1. After each iteration of `review-fix-loop` (fixers committed by `fix-commit.sh`), the loop MUST execute a **gate-replay step** that runs the **union of all `task.verification` commands** from every task in the sprint plan, deduped, against HEAD. The first token is already in `build-graph.json` by R1.1, so this is a safe re-run.
2. The replay produces `gate-replay-iter-<n>.json` under `.planning/state/<sprint_id>/` listing `{ cmd, exit, duration_ms }` per command. If any `exit !== 0`, the iteration is **not clean** — the review-fix-loop's `until` condition (`clean: true`) cannot fire on that iteration even if the textual findings list is empty.
3. The replay step is generic — no tool names. It reads `tasks.json` (or the equivalent canonical task list under `.planning/sprints/<sprint_id>/`), unions the verification commands, and runs them via Bash.
4. On replay failure, the review-fix-loop continues to the next iteration, producing fresh findings tied to the failing gates (the reviewer surfaces them as `blocking` synthetic findings with `category: "gate_replay_failure"`).

### R9 — Lint-scope discipline (planner + reviewer)

This closes G4's lint-scope drift class (the wave-smoke 55-error finding in sprint-001 came from running lint repo-wide instead of `apps/`+`packages/`).

1. **Planner rule.** A `lint` or `build` gate whose first token resolves to a project-wide invocation (e.g. `pnpm -r lint`, `pnpm exec biome check apps packages`) is permitted ONLY when `task.target_files` is empty OR every entry in `task.target_files` is repo-root-scoped (path of length 1).
2. **Default scope.** For any other task, the gate scope is the union of workspace packages whose `package.json` directory is the longest prefix of any path in `task.target_files.{create,update,remove}`. The planner emits one `pnpm --filter <pkg> lint` (or equivalent) per touched package — never a piped one-liner.
3. **Reviewer rule.** If a gate's observed file diagnostics include files outside the wave's diff, the reviewer raises a `gate_scope_drift` finding (severity `high`, `auto_fixable: false`) on the planner's plan file, not on the source code. This is a plan defect, not a source-code bug.

### R10 — Smoke-in-every-wave

This closes the "discover drift late" pattern that turned `task-smoke` into a 18-error TS5097 surprise in sprint-001.

1. The `wave-runner` (per `.claude/agents/wave-runner.md`), after builders return green and BEFORE `wave-commit`, MUST run the **sprint's terminal smoke gates** scoped to the staged diff. The commands come from the sprint's `wave-smoke` task in the plan — no tool names appear in this skill or in the agent file.
2. **Failure → retry, not commit.** If any smoke gate exits non-zero, the wave-runner returns `verdict: "fail"` with a diagnostic listing the failing gate and the union of staged files. The responsible task is retried per its `on_fail` policy. `wave-commit` does NOT run.
3. **Why staged-diff scope.** The terminal smoke wave verifies the entire repo; running its commands on each wave's staged diff catches drift in the wave that introduced it. Project-wide smoke still runs once at the end (the `wave-smoke` wave itself remains the canonical final gate).
4. **Generic mechanic.** Per R6.6, no tool names appear here. The implementation in `wave-runner.md` describes the *contract* — "run the plan's `wave-smoke.tasks[0].verification` commands scoped via the lint-scope discipline (R9)" — and the planner has already produced commands whose first tokens are in `build-graph.json`.

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
