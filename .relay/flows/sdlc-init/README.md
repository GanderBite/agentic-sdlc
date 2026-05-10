# sdlc-init

`●─▶●─▶●─▶●  sdlc-init`

## What it does

Bootstraps a new project for the Agentic SDLC.

## Sample output

A successful bootstrap writes seven artifacts and lands one commit:

```
●─▶●─▶●─▶●  sdlc-init
 ✓ load-start    artifact=start.md
 ✓ intel         INTEL.md + 6 intel files
 ✓ brainstorm    docs/APPLICATION_BRIEF.md  (1 round)
 ✓ architecture  docs/ARCHITECTURE.md       (modular-monolith, postgres)
 ✓ approve-arch  approved
 ✓ tech-stack    docs/TECH_STACK.md         (typescript / pnpm / vitest / biome)
 ✓ approve-stack approved
 ✓ skills        7 process + 3 domain skills authored
 ✓ skill-lint    pass
 ✓ prd          docs/PRD.md                 (4 v1 features)
 ✓ approve-prd   approved
 ✓ commit        sdlc/init  (1 commit, 7 files)
```

## Install

```bash
relay install sdlc-init
``` Produces every long-lived artifact downstream flows depend on:

- `docs/INTEL.md` plus `.planning/intel/*` (modules, build-graph, conventions, hot-files, test-layout, schema)
- `docs/APPLICATION_BRIEF.md` (enriched from `START.md` via the brainstormer)
- `docs/ARCHITECTURE.md` (human-approved)
- `docs/TECH_STACK.md` (human-approved)
- `.claude/skills/<name>/` packages for every domain skill the chosen stack needs, registered in `.claude/skills/INDEX.json`
- `docs/PRD.md` (human-approved)
- A single `sdlc/init` commit pushed to a dedicated branch

```
load-start ─▶ intel ─▶ brainstorm ─▶ architecture ─▶ approve-arch
                                                          │
   ┌──────────────────────────────────────────────────────┘
   ▼
tech-stack ─▶ approve-stack ─▶ skills ─▶ skill-lint ─▶ prd ─▶ approve-prd ─▶ commit
```

The `skills` step is one Relay step that fans out to N `skill-author` subagents via `Task`, sidestepping the constraint that `step.parallel` branches must be known at flow-definition time (the skill list is data-dependent on the chosen tech stack).

## Estimated cost and duration

- **Cost:** $0.50–$3.00 per run (Opus on the architecture / brainstorm / skills steps; Sonnet elsewhere; billed to your Pro/Max subscription).
- **Duration:** 15–60 minutes, dominated by the parallel `skill-author` fan-out and three human approval gates.

## Run

```bash
START_MD=./START.md relay run .
```

Drop a `START.md` in the project root before running, or skip it for a fully interactive bootstrap. The brainstormer will fill the gaps either way.

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| `repoPath` | `string` | `.` | Repository root the SDLC scaffolding lands inside. |

Environment variables consumed by the script steps:

| Variable | Used by | Purpose |
|---|---|---|
| `START_MD` | `load-start` | Path to the seed brief; the script copies it into the run artifact. |
| `QUESTION` / `ARTIFACT_PATH` | `approve-*` | Wired by the flow; the project's `scripts/ask.sh` decides how to surface the gate (TTY, web UI, Slack, ...). |

## Human gates

Three `step.script` calls invoke `scripts/ask.sh` and abort the flow on a non-zero exit:

- `approve-arch` after `architecture`
- `approve-stack` after `tech-stack`
- `approve-prd` after `prd`

Per AGENTIC_SDLC.md §13, these are hard human boundaries — do not auto-approve them.

## Customization

- **Skip the brainstorm** when you trust `START.md` to be complete: replace `prompts/02_brainstorm.md` with a one-line "echo the start.md verbatim" prompt.
- **Add a non-functional review** (security, accessibility, perf) by inserting a `step.prompt` after `prd`.
- **Pin models** per step in `flow.ts`. The defaults follow §3 of AGENTIC_SDLC.md.

## License

MIT.
