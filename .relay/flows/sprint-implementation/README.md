# sprint-implementation

`●─▶●─▶●─▶●  sprint-implementation`

## What it does

Executes one sprint: branches off `main`, walks the wave plan, fans out builder subagents per wave, runs the reviewer, retries per `task.on_fail`, commits per wave, writes a retro, and opens a PR. Resumable mid-wave via `.planning/state/<sprint_id>.json`.

```
preflight ─▶ branch ─▶ load-state ─▶ plan-execution
                                          │
                                          ▼
                                    ┌─ wave-loop ─┐
                                    │             │
                                    │   wave  ─▶ wave-commit
                                    │     ▲           │
                                    │     └───────────┘ (until all_waves_done)
                                    │             │
                                    └─────────────┘
                                          │
                                          ▼
                                  retro ─▶ report ─▶ pr
```

The `wave` step is one `step.prompt` running the wave-runner role. It fans out an unknown number of builder Tasks via `Task` (Relay forbids `step.parallel` inside `step.loop` and forbids nested loops, so dynamic fan-out and per-task retry both live inside Claude Code). Relay sees one step per wave — exactly the granularity needed for atomic per-wave commits and resumable per-wave checkpoints.

## Sample output

A successful sprint produces a per-wave commit history, a retro, and an opened PR:

```
●─▶●─▶●─▶●  sprint-implementation
 ✓ preflight        ok
 ✓ branch           sprint/014-resource-soft-delete
 ✓ load-state       state.json (5 tasks, 0 in_flight)
 ✓ plan-execution   3 waves queued
 ✓ wave (iter 1)    wave-1  pass  4 tasks done   tokens=132400
 ✓ wave-commit      feat(resource): wave-1 — soft-delete groundwork
 ✓ wave (iter 2)    wave-2  pass  3 tasks done   tokens=98000
 ✓ wave-commit      feat(resource): wave-2 — audit log
 ✓ wave (iter 3)    wave-smoke  pass  smoke green
 ✓ wave-commit      feat(resource): wave-smoke
 ✓ retro            .planning/retros/sprint-014.md + .priors-patch.json
 ✓ report           report.html
 ✓ pr               https://github.com/owner/name/pull/87
```

## Install

```bash
relay install sprint-implementation
```

## Estimated cost and duration

- **Cost:** $1–$30 per sprint (Opus on the wave-runner; Sonnet on builders by default; varies with wave count, task count, and retry rate; billed to your Pro/Max subscription).
- **Duration:** 20–240 minutes, dominated by builder fan-out and verification gate runs.

## Run

```bash
relay run . --sprintId="sprint-001" --repo="owner/name"
```

Bootstrap mode (recommended on a fresh project, per §21.1):

```bash
relay run . --sprintId="sprint-001" --repo="owner/name" --dryRun=true
```

Dry-run modifies the plan-execution step to keep only the first non-done wave restricted to its first task, drops the smoke wave, and the PR opens as a draft. Use it to verify the wave-runner / reviewer pipeline cheaply on a fresh project.

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| `sprintId` | `string` | (required) | Matches `.planning/sprints/<id>.json`. |
| `repo` | `string` | (required) | GitHub `owner/name` the PR opens against. |
| `dryRun` | `boolean` | `false` | Bootstrap mode (§21.1). |

Each script receives a `RELAY_INPUT_JSON` env var pointing at a JSON file with all flow inputs, plus `RELAY_RUN_DIR`, `RELAY_FLOW_DIR`, and `RELAY_HANDOFFS_DIR` for filesystem access. The §20 scripts contract assumes `$SPRINT_ID` / `$REPO` env names — your script wrapper should parse `RELAY_INPUT_JSON` and export those names before invoking the body, or read them directly from the JSON file.

## Resumability

Per AGENTIC_SDLC.md §8:

1. If `.planning/state/<sprint_id>.json` says `last_commit_sha == HEAD`, the wave-runner resumes from `current_wave`.
2. If the working tree is dirty, recovery is treated as an incident: the next run aborts in `preflight` and surfaces a diagnostic.
3. Tasks marked `in_progress` are restarted from scratch unless the builder wrote a `.planning/state/<sprint>/<task>.partial` marker.
4. Waves marked `done` are never re-run.

## Outputs

- One commit per wave on `sprint/<id>-<slug>`, conventional message `feat(<scope>): wave-<n> — <wave title>`.
- `.planning/state/<sprint_id>.json` — final state.
- `.planning/state/<sprint_id>/cost.jsonl` — per-task token actuals (§15.3).
- `.planning/retros/<sprint_id>.md` — human-readable retro.
- `.planning/retros/<sprint_id>.priors-patch.json` — machine-readable patch the next planner consumes.
- `report.html` — sprint report attached to the PR.
- A PR on `<repo>` (draft if `dryRun: true`).

## Failure handling

Per §9: builders retry per `task.max_attempts`; flaky tests get up to 2 re-runs gated by `verification_failure_modes`; blocked tasks land under `.planning/blocked/<sprint_id>/`; the PR opens with a `BLOCKED` label even when blocked so humans see the partial result rather than nothing.

## License

MIT.
