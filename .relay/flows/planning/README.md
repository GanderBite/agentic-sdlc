# planning

`●─▶●─▶●─▶●  planning`

## What it does

Decomposes a feature brief into one or more sprint plans.

## Sample output

A successful run produces an enriched brief, an updated coverage map, and one or more sprint files:

```
●─▶●─▶●─▶●  planning
 ✓ intel-refresh  noop (snapshot up to date)
 ✓ read-brief     brief="Resource soft-delete + audit log"
 ✓ brainstorm     1 round, 3 acceptance bullets, 0 open gaps
 ✓ needs-arch     exit 0 (existing ARCHITECTURE.md covers the feature)
 ✓ compose-tasks  6 tasks
 ✓ compose-waves  3 waves (build, build, smoke)
 ✓ compose-sprints sprint-014  budget=120000
 ✓ verify-coverage 6/6 bullets covered
 ✓ write-sprints  .planning/sprints/sprint-014.json
```

## Install

```bash
relay install planning
``` Reads the brief plus refreshed intel and produces validated `.planning/sprints/sprint-*.json` files that the `sprint-implementation` flow can execute.

```
intel-refresh ─▶ read-brief ─▶ brainstorm ─▶ needs-arch
                                                  │
                                ┌─── exit 0 ──────┤
                                │                 └─ exit 1 ─▶ extend-arch ─▶ approve-arch
                                │                                                   │
                                ▼                                                   ▼
                         compose-tasks ─▶ compose-waves ─▶ compose-sprints ─▶ verify-coverage ─▶ write-sprints
```

The compose chain is split across three sequential prompts because Relay produces one handoff per `step.prompt`. Splitting also gives Relay step-level resume granularity at each sub-stage.

`needs-architecture.sh` exits 0 when the existing `docs/ARCHITECTURE.md` covers the feature; the branch then jumps directly to `compose-tasks`. On exit 1 the flow extends the architecture and asks the human to approve before composing tasks. Either way, every downstream prompt reads `docs/ARCHITECTURE.md` from disk, so the conditional handoff is not required for correctness.

## Estimated cost and duration

- **Cost:** $0.30–$1.50 per run (Opus on the planner sub-stages; Sonnet on the brief reader; billed to your Pro/Max subscription).
- **Duration:** 5–25 minutes, dominated by the architecture branch and the three planner sub-stages.

## Run

```bash
relay run . --featureBrief=".planning/features/FEATURE-resource-deletion.md"
```

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| `featureBrief` | `string` | (required) | Path to the FEATURE-*.md file under `.planning/features/`. |

## Outputs

- `.planning/features/FEATURE-<slug>.enriched.md` — the enriched brief from the brainstorm step.
- Possibly an updated `docs/ARCHITECTURE.md` if the brief required structural extension.
- One or more `.planning/sprints/sprint-*.json` files — written by `scripts/write-sprint-files.sh`, validated against §19.1 by `scripts/validate-plan.mjs`.
- A coverage report inside the run's handoff store; surfaced in the human-readable retro after the sprint runs.

## Validation

`scripts/write-sprint-files.sh` invokes `scripts/validate-plan.mjs`. A failed validator does not consume tokens to retry — the LLM gets one corrective re-prompt with the validator's structured errors as input. Second failure escalates via `scripts/ask.sh`.

## License

MIT.
