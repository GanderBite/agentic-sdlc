# Agentic SDLC

A reference implementation of a fully automated software-delivery lifecycle, built on **[Claude Code](https://docs.claude.com/en/docs/claude-code)** subagents and skills, orchestrated by **[@ganderbite/relay](https://github.com/ganderbite/relay)** — a deterministic, crash-proof flow runner that shells to `claude -p` for LLM steps.

This repository is both the design (`docs/AGENTIC_SDLC.md`) and the running machinery: agents, skills, flows, scripts, and intel files. An example application (MedBrige — see `docs/APPLICATION.md`) is wired up as the system-under-management to exercise the pipeline end-to-end.

> **Status:** v1 scaffolding. The Relay flows, agent definitions, skills, and scripts are in place. Sprints are planned but not yet executed.

---

## Why this exists

LLM-driven engineering rewards a different shape of process than human-driven engineering does. The whole system here is shaped by a small number of constraints that come from the model, not from software-engineering tradition:

1. **Context is the scarce resource.** Tokens, not hours, are the unit of estimation. Every artifact, schema, and flow keeps individual agent contexts small.
2. **Skills replace roles.** No `frontend-engineer` or `devops-engineer` agents. One `builder` agent loads task-specified skills to become competent in the current domain.
3. **The filesystem is the communication bus.** Agents don't message each other — they read and write versioned artifacts (`*.json`, `*.md`) on disk. Parallelism, resumability, and human inspection are trivial.
4. **Verification is mechanical.** Acceptance criteria are commands that exit 0 or non-0. Reviewer agents run them; they do not interpret prose.
5. **Resumability is a first-class feature.** Every long-running flow is interruptible (session limits, weekly limits, human halt) and recoverable from a `state.json` snapshot.
6. **The planner pays for parallelism.** Agents work in parallel only when the planner has guaranteed they cannot collide on files, types, or interfaces.
7. **Humans gate ambiguity.** Anything structural (architecture, tech stack, scope, security policy) is a human checkpoint. Anything mechanical is automated.

The full rationale, schemas, and failure-handling policies live in [`docs/AGENTIC_SDLC.md`](./docs/AGENTIC_SDLC.md).

---

## How the pieces fit

```
              ┌──────────────────────────────────────────────────────────────┐
              │                    @ganderbite/relay                         │
              │  deterministic flow runner · crash-proof · resumable steps   │
              └────────────────────────────┬─────────────────────────────────┘
                                           │ shells to `claude -p`
                                           ▼
              ┌──────────────────────────────────────────────────────────────┐
              │                     Claude Code                              │
              │  subagents (.claude/agents/) · skills (.claude/skills/)      │
              │  Task tool fan-out · Read/Write/Edit/Bash tool allowlists    │
              └────────────────────────────┬─────────────────────────────────┘
                                           │ reads/writes
                                           ▼
              ┌──────────────────────────────────────────────────────────────┐
              │              Filesystem as the communication bus             │
              │   docs/ · .planning/ · .claude/ · scripts/                   │
              └──────────────────────────────────────────────────────────────┘
```

**Relay** owns the linear backbone, human gates, conditional routing, and step-level resume. **Claude Code** owns the LLM work, dynamic fan-out (a wave spawns N builders whose count is data-dependent), and skill loading. **The filesystem** owns the durable state — sprint plans, intel, retros, estimation priors — so nothing depends on session memory.

---

## Repository layout

```
.claude/
  agents/                  # subagent definitions (markdown with frontmatter)
  skills/                  # skill packages (SKILL.md + references/)
  agent-memory/            # per-agent persistent memory
.relay/
  flows/                   # Relay flow packages (sdlc-init, planning, ...)
  runs/                    # per-run scratch state (gitignored)
.planning/
  intel/                   # codebase intelligence (modules, build-graph, ...)
  features/                # per-feature briefs (FEATURE-*.md)
  sprints/                 # sprint-{id}.json (planned + executed)
  state/                   # active sprint state, checkpoints (gitignored)
  retros/                  # per-sprint retro artifacts
docs/
  AGENTIC_SDLC.md          # the design document — read this first
  APPLICATION.md           # the example app brief (MedBrige)
  APPLICATION_BRIEF.md     # enriched brief from the brainstormer
  ARCHITECTURE.md          # human-approved architecture
  TECH_STACK.md            # human-approved tech stack
  PRD.md                   # human-approved PRD
  INTEL.md                 # single-page codebase summary
scripts/                   # deterministic guardrails (validators, git, gh)
```

Anything in `.planning/` (except `state/`) is checked in. It is the durable memory of the agentic system across sessions and across humans on the team.

---

## The four Relay flows

Each flow is a standalone `@ganderbite/relay-core` package under `.relay/flows/<name>/`. Phases are not composed — they hand off via the filesystem.

### `sdlc-init` — bootstrap a project

`docs/APPLICATION.md` → `INTEL.md`, `APPLICATION_BRIEF.md`, `ARCHITECTURE.md`, `TECH_STACK.md`, the starter skill set, `PRD.md`, one `sdlc/init` commit. Three human approval gates (architecture, tech stack, PRD).

```bash
START_MD=./docs/APPLICATION.md relay run .relay/flows/sdlc-init
```

**Cost:** $0.50–$3.00 · **Duration:** 15–60 min (dominated by parallel `skill-author` fan-out and human approvals).

### `planning` — plan a feature into sprints

`FEATURE-*.md` + `INTEL.md` + `estimation_priors.json` → one or more validated `.planning/sprints/sprint-*.json`. Composes tasks, groups them into waves enforcing disjointness and dependency invariants, appends a smoke wave, and verifies coverage of every acceptance bullet.

```bash
relay run .relay/flows/planning --featureBrief=".planning/features/FEATURE-resource-deletion.md"
```

**Cost:** $0.30–$1.50 · **Duration:** 5–25 min.

### `sprint-implementation` — execute a sprint

Branches off `main`, walks the wave plan, fans out builder subagents per wave (via Claude Code's `Task` tool — Relay forbids `step.parallel` inside `step.loop`), runs the reviewer, retries per `task.on_fail`, commits per wave, writes a retro, and opens a PR. Resumable mid-wave from `.planning/state/<sprint_id>.json`.

```bash
# Bootstrap mode — runs only the first wave's first task; PR opens as draft.
relay run .relay/flows/sprint-implementation --sprintId="sprint-001" --repo="owner/name" --dryRun=true

# Real run.
relay run .relay/flows/sprint-implementation --sprintId="sprint-001" --repo="owner/name"
```

**Cost:** $1–$30 per sprint · **Duration:** 20–240 min.

### `intel-refresh` — maintenance

Diffs the codebase against `.planning/intel/.snapshot` and patches only the intel files affected. A clean run skips the rebuild entirely — the single biggest cost saving in the pipeline.

```bash
relay run .relay/flows/intel-refresh                # diff-only
relay run .relay/flows/intel-refresh --full=true    # force full rebuild
```

**Cost:** $0.05–$0.50 (≈free on a noop) · **Duration:** seconds–10 min.

---

## The agent roster

Seven Claude Code subagents under `.claude/agents/`. Each has a fixed role, a recommended model, and an always-on skill set. Per-task skills load on top via `Read` on `.claude/skills/<name>/SKILL.md`.

| Agent | Model | Always-on skills | Purpose |
|---|---|---|---|
| `feature-brief-brainstormer` | Opus | `brain-storming` | Turn vague briefs into unambiguous ones via ≤3 rounds of directed questions. |
| `intel-keeper` | Sonnet | `codebase-mapping` | Build and diff-update `INTEL.md` + `.planning/intel/`. |
| `sprint-planner` | Opus | `sprint-planning` | Compose tasks/waves/sprints. Enforces wave invariants and coverage. |
| `task-builder` | Sonnet (default), Opus (heavy), Haiku (trivial) | `version-control` | Implement a single task end-to-end. Spawned in parallel within a wave. |
| `wave-runner` | Opus | `version-control`, `verification-gates` | Orchestrate one wave: fan out builders, run reviewer, apply retries, emit `wave_result`. |
| `wave-reviewer` | Opus | `code-reviewing` | Run mechanical verification gates + structured cross-cutting audit. |
| `skill-author` | Opus | `skill-authoring` | Create new skills during `sdlc-init` for the chosen tech stack. |

The same agent definition is invoked two ways: as a Relay `step.prompt` (the linear backbone) and as a `Task` subagent spawned from inside another step's prompt (dynamic fan-out — the builder swarm inside a wave). See [`docs/AGENTIC_SDLC.md` §3](./docs/AGENTIC_SDLC.md) for the full invocation model.

---

## Skills

A **skill** is a small markdown package (`.claude/skills/<name>/SKILL.md` + `references/*.md`) that captures domain expertise. Skills are loaded on-demand to keep agent contexts lean. The registry at `.claude/skills/INDEX.json` is the single source of truth — a skill not in the index cannot be referenced.

Process skills used by the SDLC itself:

- `brain-storming` · `codebase-mapping` · `sprint-planning` · `code-reviewing` · `skill-authoring` · `version-control` · `verification-gates`

Domain skills authored for the example app's stack (TypeScript / pnpm / Hono / drizzle / React / Tanstack / Tailwind / Shadcn / Vitest / Biome / Zod):

- `typescript` · `pnpm-workspaces` · `biome` · `vitest` · `zod`
- `hono` · `drizzle`
- `react` · `tanstack-router` · `tanstack-query` · `tailwind` · `shadcn-ui`

New skills land on a dedicated `skills/` branch and are merged separately from feature work, gated by `scripts/skill-linter.mjs` (≤5k tokens per `SKILL.md`, no duplicate domain coverage, no external URLs).

---

## Scripts — the deterministic guardrails

Validators and orchestration glue live under `scripts/`. They are scripts, not LLM calls — they fail fast and produce structured errors the LLM can react to.

| Script | Purpose |
|---|---|
| `preflight.sh` | Verifies git state, tools on `PATH`, deps installed, `gh auth`, plan schema. |
| `validate-plan.mjs` | Wave invariants, coverage, dependency cycles, smoke wave present, hint enforcement. |
| `validate-review.mjs` | Reviewer output schema + coordinate checks; bounces malformed findings once. |
| `validate-state.mjs` | Sprint-resume sanity: `last_commit_sha` reachable, no orphaned in-progress tasks. |
| `skill-linter.mjs` | Per-skill size/structure checks against `INDEX.json`. |
| `merge-priors.mjs` | Folds `priors-patch.json` from each retro into `estimation_priors.json` deterministically. |
| `sprint-branch.sh`, `wave-commit.sh`, `open-pr.sh` | Git + GitHub plumbing, all idempotent. |
| `reserve-sprint-id.sh` | Atomic ID reservation so parallel sprints don't collide. |
| `intel-refresh.sh` | Inline trigger for the `intel-refresh` flow from inside `planning`. |
| `build-report.sh` | Per-sprint HTML report attached to the PR. |

Full contract: [`docs/AGENTIC_SDLC.md` §20](./docs/AGENTIC_SDLC.md).

---

## Quickstart

```bash
# 1. Install Claude Code and Relay.
npm i -g @anthropic-ai/claude-code
npm i -g @ganderbite/relay-cli

# 2. Drop a START.md (or use the example app brief).
cp docs/APPLICATION.md ./START.md

# 3. Bootstrap — produces ARCHITECTURE.md, TECH_STACK.md, PRD.md, INTEL.md, skills.
START_MD=./START.md relay run .relay/flows/sdlc-init
#   → approve ARCHITECTURE.md, TECH_STACK.md, PRD.md at the three human gates.
#   → merge the sdlc/init PR.

# 4. Write a feature brief.
$EDITOR .planning/features/FEATURE-resource-deletion.md

# 5. Plan it.
relay run .relay/flows/planning --featureBrief=".planning/features/FEATURE-resource-deletion.md"

# 6. Dry-run the pipeline once on a fresh project (one wave, one task, draft PR).
relay run .relay/flows/sprint-implementation \
  --sprintId="sprint-001" --repo="owner/name" --dryRun=true

# 7. Run the sprint for real.
relay run .relay/flows/sprint-implementation \
  --sprintId="sprint-001" --repo="owner/name"

# 8. Optional: refresh intel on demand or via a post-merge hook.
relay run .relay/flows/intel-refresh
```

The `--dryRun` mode in step 6 is the bootstrap path: never skip it on a fresh project. See [`docs/AGENTIC_SDLC.md` §21](./docs/AGENTIC_SDLC.md) for what to watch on the first sprint.

---

## State, resumability, learning

Two state layers cooperate:

| Layer | Lives in | Lifetime | Purpose |
|---|---|---|---|
| Relay run state | `.relay/runs/<run_id>/` | one `relay run` invocation | step status, handoffs, atomic resume |
| SDLC sprint state | `.planning/state/<sprint_id>.json` | many invocations across the sprint | task/wave status, last commit SHA, in-flight markers |

Relay handles step-level resume (re-execute the failed step). SDLC state handles task-level resume (which task within a wave was in flight). A wave-runner re-entering a partially-completed wave reads the state file first and skips tasks marked `done`.

**Learning happens through `estimation_priors.json`.** Each retro emits a `priors-patch.json` (a structured patch — never a prose rewrite) that `scripts/merge-priors.mjs` folds in deterministically. The next planner run consumes the updated multipliers when estimating tokens. Wave-invariant violations the reviewer detects graduate from "hint" to "enforced" after 3 sprints' evidence — the only mechanism that makes the planner less stupid over time.

---

## Human-in-the-loop boundaries

Hard boundaries — humans are always required:

- Initial feature/application brief (source of truth)
- Architecture and tech-stack choices on `sdlc-init` (long-lived, structural)
- New skill merge (prevents skill creep)
- Resolving `blocking` + `auto_fixable: false` review findings
- Anything requiring credentials, env vars, infra access
- Force-push, branch deletion, merge to main

Soft boundaries — humans optional:

- Brainstorm rounds (`step.ask` ≤ 3 rounds; humans can accept early)
- Non-blocking review findings (annotated in the PR body)

Everything else runs without prompting.

---

## Further reading

- [`docs/AGENTIC_SDLC.md`](./docs/AGENTIC_SDLC.md) — the full blueprint: schemas, flow shapes, agent system prompts, failure handling, validators, learning loop.
- [`.relay/flows/sdlc-init/README.md`](./.relay/flows/sdlc-init/README.md) · [`planning`](./.relay/flows/planning/README.md) · [`sprint-implementation`](./.relay/flows/sprint-implementation/README.md) · [`intel-refresh`](./.relay/flows/intel-refresh/README.md) — per-flow docs with sample output, configuration, and customization notes.
- [`.claude/agents/`](./.claude/agents/) — the seven subagent definitions.
- [`.claude/skills/INDEX.json`](./.claude/skills/INDEX.json) — registered skills.

---

## License

MIT.
