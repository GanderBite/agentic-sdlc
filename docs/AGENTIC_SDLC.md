# Agentic SDLC

A fully automated software delivery lifecycle built on **Claude Code**, **skills**, **subagents**, and **Relay** workflows. This document is a prescriptive blueprint — the schemas, file paths, agent definitions, and flow shapes here are intended to be directly implementable.

It is a successor to and refinement of [`AGENTIC_SDLC_IDEA.md`](./AGENTIC_SDLC_IDEA.md). Where the idea doc explores possibilities, this doc commits to them.

---

## 1. Principles

The whole system is shaped by a small number of constraints that come from the LLM, not from software engineering tradition.

1. **Context is the scarce resource.** Tokens, not hours, are the unit of estimation. Every artifact, schema, and flow is designed to keep individual agent contexts small and the orchestrator lean.
2. **Skills replace roles.** No `frontend-engineer` or `devops-engineer` agents. There is one `builder` agent that loads task-specified skills to become competent in the current domain.
3. **The filesystem is the communication bus.** Agents do not message each other. They read and write versioned artifacts (`*.json`, `*.md`) on disk. This makes parallelism, resumability, and human inspection trivial.
4. **Verification is mechanical.** Acceptance criteria are commands that exit 0 or non-0. Reviewer agents run them; they do not interpret prose.
5. **Resumability is a first-class feature.** Every long-running flow is interruptible (session limits, weekly limits, human halt) and recoverable from a `state.json` snapshot.
6. **The planner pays for parallelism.** Agents work in parallel only when the planner has guaranteed they cannot collide on files, types, or interfaces.
7. **Humans gate ambiguity.** Anything with structural impact (architecture, tech stack, scope, security policy, ambiguous decisions) is a human checkpoint. Anything mechanical is automated.

---

## 2. Repository layout

The SDLC machinery lives under three top-level directories in the target repository:

```
.claude/
  agents/                  # subagent definitions (markdown with frontmatter)
  skills/                  # skill packages (SKILL.md + references/)
  settings.json            # permissions, env, hooks
docs/
  ARCHITECTURE.md          # picked once, updated on structural change
  TECH_STACK.md            # languages, frameworks, build tooling
  PRD.md                   # product requirements (per application)
  INTEL.md                 # codebase intel (see §4)
.planning/
  features/                # per-feature briefs (FEATURE-*.md)
  sprints/                 # sprint-{id}.json (planned + executed)
  state/                   # active sprint state, checkpoints
  retros/                  # per-sprint retro artifacts
  intel/                   # supporting intel files (modules, hot files, conventions)
```

Anything in `.planning/` is checked into the repository. It is the durable memory of the agentic system across sessions and across humans on the team.

---

## 3. The agent roster

Five agents. Each has a fixed role, a recommended model, and the skills it must always load. Per-task skills are loaded on top.

| Agent | Model | Permissions | Always-on skills | Purpose |
|---|---|---|---|---|
| `brainstormer` | Opus | Read | `brain-storming` | Interrogate the human input until the feature/application brief is complete and unambiguous. |
| `intel-keeper` | Sonnet | Read | `codebase-mapping` | Build and update `INTEL.md` and `.planning/intel/`. Runs on `sdlc-init` and on demand. |
| `planner` | Opus | Read | `sprint-planning` | Produce sprint/wave/task plans. Verifies wave invariants and contract dependencies. |
| `builder` | Sonnet (default), Opus (heavy tasks), Haiku (trivial) | Read, Write, Edit, Bash | per-task | Implement a single task end-to-end. Spawned in parallel within a wave. |
| `reviewer` | Opus | Read, Bash | `code-reviewing` | Run verification gates, audit cross-cutting concerns, emit `review-{wave}.json`. |
| `skill-author` | Opus | Read, Write | `skill-authoring` | Create new skills during `sdlc-init` based on the chosen tech stack. Human-gated before merge. |

Builder agent model selection comes from the task's `model` field, not from the agent definition.

**Two invocation patterns.** Each agent is a Claude Code subagent definition under `.claude/agents/` and can be invoked two ways:

1. **As the role of a Relay `step.prompt`** — the prompt file embodies the role, and Relay's `tools` allowlist enforces permissions. Used for the linear backbone (intel-keeper, planner sub-stages, brainstormer, retro).
2. **As a `Task` subagent** spawned from inside another step's prompt — used when the parent step needs dynamic fan-out or nested control flow Relay doesn't support (builders inside a wave; skill-authors inside `sdlc-init`'s `skills` step).

The same agent definition is used in both cases.

**How skills get loaded.** This is mechanical and constrained — worth being precise:

- **The `Skill` tool is main-conversation-only.** Subagents (anything spawned via `Task`) **cannot** invoke `Skill` themselves. So per-task skill loading must use a different mechanism.
- **Always-on skills** are declared in the subagent's frontmatter `skills:` field (e.g. `.claude/agents/reviewer.md` has `skills: [code-reviewing, version-control]`). Claude Code injects these at subagent init.
- **Per-task skills** (different tasks need different domain skills) cannot be set in static frontmatter. The builder receives `task.skills` in its spawn prompt and uses `Read` on `.claude/skills/<name>/SKILL.md` for each before starting work. `references/*.md` are read on demand.

`task.skills` in the schema (§5.1) therefore means: "the builder will Read these SKILL.md files first," not "the builder will call `Skill(...)`." The §6.2 `INDEX.json` registry exists so the builder can validate names and find paths.

---

## 4. The Discovery / Intel phase

Codebase exploration is expensive and forgettable. Treat it as a persistent artifact.

`docs/INTEL.md` is the single-page summary humans and agents both read. It is supported by deeper files in `.planning/intel/`:

```
.planning/intel/
  modules.json             # name → path, owner, dependencies
  conventions.md           # naming, layering, error-handling, logging style
  hot-files.md             # files touched in >N% of recent commits
  test-layout.md           # where tests live, how they're named, how they run
  build-graph.json         # build/test commands per package
  schema.md                # database schema summary, migration tooling
```

**Updating, not regenerating.** The `intel-keeper` agent runs at the *start* of each sprint, but only diffs the codebase against the last intel snapshot (`.planning/intel/.snapshot`) and patches what changed. A clean run skips the rebuild entirely.

This is the single biggest cost saving in the whole pipeline.

### 4.1 Intel file schemas

The planner's correctness depends on the precision of these files. Loose intel produces broken plans. Each file has a fixed shape so the planner can rely on field names rather than parsing prose.

**`.planning/intel/modules.json`**

```json
{
  "modules": [
    {
      "name": "resource",
      "path": "src/modules/resource",
      "language": "typescript",
      "test_path": "src/modules/resource/__tests__",
      "depends_on": ["common", "auth"],
      "exports": ["src/modules/resource/index.ts"],
      "owners": ["@team-platform"]
    }
  ]
}
```

**`.planning/intel/build-graph.json`** — the canonical map from "I changed these files" to "run these commands."

```json
{
  "tools": {
    "package_manager": "pnpm",
    "test_runner": "vitest",
    "linter": "biome",
    "builder": "tsc"
  },
  "global": {
    "test":  "pnpm test",
    "lint":  "pnpm lint",
    "build": "pnpm build",
    "typecheck": "pnpm typecheck"
  },
  "per_module": {
    "resource": {
      "test":  "pnpm test --filter resource",
      "lint":  "pnpm lint --filter resource",
      "build": "pnpm build --filter resource"
    }
  },
  "smoke": ["pnpm test", "pnpm build", "pnpm lint"]
}
```

The planner derives `task.verification` strictly from this file; it does not invent commands. If a needed command is missing, the planner fails fast and asks the human via `step.ask` to extend the build graph.

**`.planning/intel/conventions.md`** — semi-structured. Sections for: naming, layering, error handling, logging, public/private boundaries, test conventions. The planner copies the relevant section into each task's `context`.

**`.planning/intel/hot-files.md`** — files touched in >N% of the last 200 commits. Used by the planner as a soft signal: tasks touching hot files get higher review priority and lower max_parallelism.

**`.planning/intel/test-layout.md`** — where tests live, naming convention, fixtures location, mock strategy. Used by builder when deciding where to place new tests.

**`.planning/intel/schema.md`** — DB schema summary + migration tooling location. Used when a task touches data layer.

**`.planning/intel/.snapshot`** — opaque hash of the codebase state at last intel run. The diff-only refresh in §4 compares `git diff <snapshot>..HEAD` to decide what to update.

---

## 5. The schemas

### 5.1 Task

```json
{
  "id": "task-<short-hash>",
  "title": "Add soft-delete to Resource model",
  "description": "Detailed prose explaining what to do.",
  "context": [
    "References INTEL.md §Modules/resource",
    "Soft-delete pattern decision: see ARCHITECTURE.md §Deletion"
  ],
  "references": [
    "src/modules/resource/resource.model.ts",
    "docs/ARCHITECTURE.md"
  ],
  "target_files": {
    "create": ["src/modules/resource/soft-delete.ts"],
    "update": ["src/modules/resource/resource.service.ts"],
    "remove": [],
    "may_also_touch": ["src/modules/resource/index.ts"]
  },
  "verification": {
    "tests":  ["pnpm test --filter resource"],
    "lint":   ["pnpm lint --filter resource"],
    "build":  ["pnpm build --filter resource"],
    "files_exist": ["src/modules/resource/soft-delete.ts"],
    "custom": [
      { "cmd": "rg 'deletedAt' src/modules/resource/resource.model.ts", "expect_exit": 0 }
    ]
  },
  "skills": ["typescript", "prisma"],
  "model": "sonnet",
  "estimate_tokens": 18000,
  "depends_on": ["task-7f2a"],
  "depends_on_contracts": [],
  "max_attempts": 2,
  "on_fail": "escalate",
  "status": "todo",
  "attempts": [],
  "actuals": null
}
```

Field semantics:

- `verification` — block of commands. Reviewer runs each; non-zero exit fails the task. Replaces prose acceptance criteria.
- `target_files` — three categories with different strictness:
  - `create` / `update` / `remove` are **advisory expected scope.** Builder is told to stay within these but is *allowed* to touch additional files when implementation requires it (e.g. an index re-export, an adjacent test helper). Each out-of-scope edit produces a reviewer warning, not an automatic revert.
  - `may_also_touch` is the planner's pre-blessed list of allowed-but-not-required files (re-export indexes, hot files known to be co-edited). Touches here produce no warning.
  - The wave invariant (§5.2) operates on the union of `create + update + remove`. `may_also_touch` is **excluded** from the disjointness check (multiple tasks can co-edit it).
- `model` per task. Opus for cross-cutting/architectural, Sonnet default, Haiku for mechanical.
- `depends_on_contracts` — usually empty in v1. See §5.4.
- `max_attempts` and `on_fail` define retry/escalation (§9).
- `attempts[]` — runtime log: `{ attempt_n, started_at, ended_at, result, agent_id, summary, tokens_used, files_touched }`.
- `actuals` (filled at sprint end) — `{ tokens_used, wall_clock_ms, files_touched, verification_results }`. Drives retros.

### 5.1.1 How the planner derives a task

This is mechanical, not creative. The planner follows the same recipe for every task:

1. **Pick `target_files`** from the feature description + INTEL `modules.json` + `hot-files.md`. Use the smallest set that plausibly delivers the change. Add hot-files to `may_also_touch`.
2. **Pick `verification`** strictly from `build-graph.json`:
   - `tests` ← `per_module[<module>].test` if the change is module-local, else `global.test`.
   - `lint` ← same pattern.
   - `build` ← only if the change touches non-test source.
   - `files_exist` ← `target_files.create`, plus any test file the planner expects.
   - `custom` — only when a literal symbol must appear (e.g. a new flag in a config). Use `rg` with `--quiet`.
   - If a needed command isn't in `build-graph.json`, the planner fails the planning flow with a `step.ask` requesting the human to extend the graph.
3. **Pick `skills`** from `INDEX.json`. Match by domain: language → 1 skill, framework → 1 skill, data layer (if touched) → 1 skill. Hard cap of 4 skills per task to keep builder context lean.
4. **Pick `model`**:
   - `opus` if the task touches `>5` files OR involves new architecture, security, or data-schema decisions.
   - `haiku` if the task is a pure rename, config edit, or doc update with no logic.
   - `sonnet` otherwise (the common case).
5. **Estimate `estimate_tokens`** using §15 heuristics adjusted by `estimation_priors.json` (§5.5).
6. **Pick `depends_on`** by static analysis: if task A creates a file that task B imports/updates, B depends on A.
7. **Pick `depends_on_contracts`** only if §5.4's "use a contract?" gate fires.

This recipe is encoded in the `sprint-planning` skill so the planner is reproducible.

### 5.2 Wave

```json
{
  "id": "wave-1",
  "kind": "build" | "contract" | "review" | "integration",
  "tasks": ["task-...", "..."],
  "token_budget": 200000,
  "max_parallelism": 4,
  "status": "todo"
}
```

Wave invariants the planner must enforce:

1. No task in the wave appears in another task's `depends_on` *within the same wave*.
2. `target_files` sets are pairwise disjoint across tasks in the wave.
3. Sum of `estimate_tokens` ≤ `token_budget`.
4. Number of concurrent builders ≤ `max_parallelism`.
5. All `depends_on_contracts` for every task in this wave are satisfied by an earlier wave.

A wave whose `kind` is `contract` produces shared interface stubs (see §5.4). A wave whose `kind` is `review` contains one task: invoke the `reviewer` agent.

### 5.3 Sprint

```json
{
  "id": "sprint-001",
  "title": "Resource soft-delete + audit log",
  "feature_brief": ".planning/features/FEATURE-resource-deletion.md",
  "branch": "sprint/001-resource-soft-delete",
  "waves": ["wave-...", "..."],
  "orchestrator_token_budget": 150000,
  "status": "todo",
  "created_at": "...",
  "started_at": null,
  "completed_at": null
}
```

The `orchestrator_token_budget` is what bounds sprint size: if the orchestrator agent itself would have to track too many concurrent waves, the planner splits the work into multiple sprints rather than a single mega-sprint.

### 5.4 Contract artifact (optional, v1)

Contracts up front are powerful but easy to over-use. **The planner uses contracts only when ALL of the following hold:**

- ≥3 tasks in the next wave depend on the same shared interface.
- The interface is non-trivial (≥2 fields or ≥1 method) and the parties don't already agree (e.g. it's net-new, not "extend an existing type").
- A wrong shape would force re-work in ≥2 of those tasks.

If those conditions don't hold, the planner skips contracts and lets the natural dependency graph order the tasks. Most v1 sprints will have zero contract waves. This is intentional — over-specifying interfaces before the implementation pulls them is a classic failure mode of waterfall planning that v1 should avoid.

When contracts *are* used, they emit:

```
.planning/sprints/sprint-001/contracts/contract-<name>/
  contract.md          # human-readable: rationale, expected behavior
  types.ts             # frozen TypeScript interfaces (or schema.prisma, openapi.yaml, etc.)
  fixtures.json        # optional: example payloads
```

A contract is immutable for the duration of the sprint. If a contract turns out wrong mid-execution, the dependent wave fails and the planner re-plans (§9, "Contract turns out wrong"). The reviewer flags excessive contract churn in retros so the planner learns to use them more sparingly.

### 5.5 `estimation_priors.json` — the learning artifact

This file is the *only* mechanism by which the planner improves between sprints. It must be machine-consumable, not prose.

`.planning/estimation_priors.json`:

```json
{
  "version": 3,
  "updated_at": "2026-05-10T12:00:00Z",
  "skill_multipliers": {
    "typescript":     { "mean_ratio": 1.05, "n": 42, "stddev": 0.18 },
    "prisma":         { "mean_ratio": 1.45, "n": 12, "stddev": 0.31 },
    "react":          { "mean_ratio": 0.95, "n": 31, "stddev": 0.22 }
  },
  "model_multipliers": {
    "opus":   { "mean_ratio": 1.15, "n": 18 },
    "sonnet": { "mean_ratio": 1.00, "n": 80 },
    "haiku":  { "mean_ratio": 0.85, "n": 14 }
  },
  "kind_multipliers": {
    "new_module":     { "mean_ratio": 1.30, "n": 9  },
    "extend_module":  { "mean_ratio": 1.05, "n": 47 },
    "rename":         { "mean_ratio": 0.70, "n": 8  },
    "test_only":      { "mean_ratio": 0.85, "n": 22 }
  },
  "wave_invariant_hints": [
    {
      "pattern": "tasks both touching .+/index\\.ts",
      "advice":  "treat index.ts as may_also_touch, not target_files.update",
      "evidence_sprints": ["sprint-007", "sprint-013"]
    }
  ],
  "verification_failure_modes": [
    { "command": "pnpm test --filter <module>", "flake_rate": 0.04, "n": 73 }
  ]
}
```

**How the planner uses it:**

```
final_estimate = base_estimate
                 × (geomean of skill_multipliers[task.skills])
                 × model_multipliers[task.model]
                 × kind_multipliers[task.kind]
```

`mean_ratio` = `actual_tokens / estimated_tokens`. >1 means we under-estimate. The planner only trusts a multiplier when `n ≥ 5`; otherwise it uses 1.0.

**`wave_invariant_hints`** are appended by the reviewer when a sprint hits a wave-invariant violation. The planner reads them and adjusts wave composition heuristics (e.g. "demote `index.ts` from `update` to `may_also_touch` when N tasks touch it").

**`verification_failure_modes`** track flake rates per command. The reviewer uses these to decide retry-on-flake budgets (§9.1).

**Retro updates this file via a structured patch, not a prose rewrite.** The retro produces a `priors-patch.json` that the next planner run merges:

```json
{
  "skill_multipliers": {
    "prisma": { "delta_n": 3, "delta_ratio_sum": 1.40 }
  },
  "wave_invariant_hints_add": [
    { "pattern": "...", "advice": "...", "evidence_sprints": ["sprint-014"] }
  ]
}
```

A merge script (`scripts/merge-priors.mjs`) folds the patch into `estimation_priors.json` deterministically. The LLM never directly rewrites the priors file — it only emits patches.

---

## 6. Skills

### 6.1 Skill structure

```
.claude/skills/<skill-name>/
  SKILL.md
  references/
    <topic>.md
```

`SKILL.md` is the entry point. It must be ≤ ~5k tokens; deeper material lives under `references/` and is loaded on demand.

### 6.2 Skill registry

`.claude/skills/INDEX.json` is the single source of truth for which skills exist:

```json
{
  "skills": [
    {
      "name": "typescript",
      "version": "1.0.0",
      "domain": "language",
      "description": "Idiomatic TypeScript: types, generics, project structure.",
      "consumes": ["tsconfig.json", "package.json"],
      "produces": ["*.ts files"],
      "size_tokens": 3200
    }
  ]
}
```

The planner consults `INDEX.json` to pick `task.skills`. The `skill-author` agent updates this file when it adds a skill. A skill not in `INDEX.json` cannot be referenced.

### 6.3 Required skill set (starter pack)

Process skills (used by the SDLC itself):

| Skill | Used by | Purpose |
|---|---|---|
| `brain-storming` | brainstormer | Directed-question protocol for filling feature gaps |
| `codebase-mapping` | intel-keeper | How to derive `INTEL.md` and supporting files |
| `sprint-planning` | planner | Task/wave/sprint schemas, estimation, wave invariants |
| `code-reviewing` | reviewer | Verification gate execution + cross-cutting audit |
| `skill-authoring` | skill-author | How to write good skills (and when not to) |
| `version-control` | builder, reviewer | Branching, conventional commits, PR hygiene |
| `verification-gates` | builder, reviewer | How to write and run mechanical verification |

Domain skills (the starter pack expands per project):

| Skill | Domain |
|---|---|
| `typescript`, `python`, `go` | languages |
| `react`, `nextjs`, `nestjs`, `fastapi` | frameworks |
| `prisma`, `postgres`, `sqlmigrations` | data |
| `rest-api`, `graphql` | API design |
| `vitest`, `playwright`, `pytest` | testing |
| `docker`, `github-actions`, `terraform` | infra |

### 6.4 Skill loading mechanics

Two paths into a Claude context, depending on who needs the skill:

| Consumer | Mechanism | Notes |
|---|---|---|
| Top-level `claude -p` step (Relay `step.prompt` directly embodying a role) | The prompt file references skills explicitly and may invoke the `Skill` tool, since the top-level Claude has access to it | Used for the linear-backbone roles whose skill set is static |
| Subagent spawned via `Task` | Either (a) `skills: [...]` frontmatter for always-on skills, or (b) the subagent uses `Read` on `.claude/skills/<name>/SKILL.md` for per-task skills | The `Skill` tool is **not** available inside subagents |
| Skill-author writing a new skill | `Write` to `.claude/skills/<name>/SKILL.md` and `references/`, then update `INDEX.json` | Linter run as a `step.script` after the authoring step |

This matters for the wave-runner: it spawns builders via `Task` with `task.skills` in the spawn prompt. Each builder reads its skill files itself. The wave-runner does **not** read the skills into its own context first — that would bloat the orchestrator's context proportional to wave size. Skills travel with the builder, not with the orchestrator.

### 6.5 Skill-authoring guardrails

The `skill-author` agent is constrained by:

- Mandatory `INDEX.json` entry for every new skill.
- A linter step (script, not agent) that checks for: duplicate domain coverage, oversized `SKILL.md`, missing `references/`.
- Human review before merge to `main` for any new skill.
- New skills land on a `skills/` branch and are merged separately from feature work.

---

## 7. Phases and Relay flows

The orchestration runtime is [Relay](file:///Users/michalgasiorek/projekty/ganderbite/relay) — a deterministic, crash-proof flow runner that shells to `claude -p` (subscription mode) for LLM steps. Before describing the four flows, we have to settle how Relay's primitives map to the SDLC concepts, because three Relay constraints shape the design.

### 7.0 Relay integration model

**Constraints we're designing around:**

1. **No `step.parallel` inside `step.loop`.** Loop bodies cannot fan out.
2. **No flow composition.** A flow cannot invoke another flow as a sub-step. Multi-stage pipelines are separate `relay run` invocations.
3. **One output per step.** A `step.prompt` produces one handoff (JSON) or one artifact (file). Multiple outputs require multiple steps or `step.parallel` (which only allows pre-declared, fixed-cardinality branches).
4. **No named-skill or named-agent selection per step.** A step is a `claude -p` invocation; "agent" is encoded by the prompt file plus the `tools` allowlist plus, when needed, a Claude Code subagent spawned via `Task` from inside that prompt.
5. **No `onStepStart` hook.** Observability is by polling `state.json` and reading post-step handoffs.

**Two design rules that fall out of those constraints:**

- **Static parallelism uses Relay's `step.parallel`.** When the branch count is known at flow-definition time (e.g. three independent reviewer perspectives), use Relay-native fan-out.
- **Dynamic parallelism (data-dependent N) lives inside Claude via `Task`.** When a step needs to fan out an unknown number of subtasks (e.g. *N builders for N tasks in a wave*), the Relay step is one `step.prompt` whose body uses `Task` to spawn subagents. Relay sees one step; Claude Code internally tracks N children. We trade Relay-level cost granularity for the ability to fan out dynamically and to nest fan-out inside a loop.

**Mapping of SDLC concepts to Relay primitives:**

| SDLC concept | Relay primitive | Notes |
|---|---|---|
| Linear phase backbone | sequential `step.prompt` / `step.script` | one handoff per step |
| Per-wave loop | `step.loop` over a single-`step.prompt` body | the body invokes the wave-runner role |
| Builder fan-out within a wave | `Task` subagents inside the wave-runner prompt | dynamic — not Relay-level |
| Static fan-out (known N) | `step.parallel` | predetermined at flow-def time |
| Human gate | `step.ask` | |
| Conditional routing | `step.branch` | shell exit codes mapped to next step |
| Non-LLM work (git, gh, scripts) | `step.script` | |
| Cross-flow handoff | filesystem (`docs/`, `.planning/`) | flows can't compose |

**"Agents" in this doc.** When §3 lists `builder`, `reviewer`, etc. as agents, that means: each is a Claude Code subagent definition under `.claude/agents/`. Relay never "selects an agent" — instead, a Relay `step.prompt` either *is* one of these agent roles (the prompt file = the role's instructions, with the tools allowlist = the role's permissions), or the prompt invokes the role via `Task(subagent_type=…)` from inside another agent. The concrete table in §14 shows both patterns.

**Two-layer state.**

| Layer | Lives in | Lifetime | Purpose |
|---|---|---|---|
| Relay run state | `.relay/runs/<run_id>/` | one `relay run` invocation | step status, handoffs, atomic resume |
| SDLC sprint state | `.planning/state/<sprint_id>.json` | many invocations across the sprint | task/wave status, last commit SHA, in-flight markers |

Relay handles step-level resume (re-execute the failed step). SDLC state handles task-level resume (which task within a wave was in flight). They cooperate: a `wave` step that crashes mid-fan-out is restarted by Relay; the prompt then reads SDLC state to skip already-finished tasks.

---

### 7.1 `sdlc-init` — bootstrap a project

**Input:** optional `START.md`.
**Output:** `docs/ARCHITECTURE.md`, `docs/TECH_STACK.md`, `docs/PRD.md`, `docs/INTEL.md`, populated `.claude/skills/`.

```ts
defineFlow({
  name: "sdlc-init",
  steps: [
    step.script({ id: "load-start", artifact: "start.md",
                  cmd: "scripts/load-start.sh" }),

    step.prompt({ id: "intel", promptFile: "01_intel.md",
                  tools: ["Read","Glob","Grep","Bash","Write"],
                  handoff: "intel" }),

    step.prompt({ id: "brainstorm", promptFile: "02_brainstorm.md",
                  contextFrom: ["load-start","intel"], handoff: "brief" }),

    step.prompt({ id: "architecture", promptFile: "03_architecture.md",
                  contextFrom: ["brief","intel"], handoff: "architecture" }),
    step.ask({ id: "approve-arch", question: "Approve ARCHITECTURE.md?",
               contextFrom: ["architecture"] }),

    step.prompt({ id: "tech-stack", promptFile: "04_tech_stack.md",
                  contextFrom: ["architecture","brief"], handoff: "tech_stack" }),
    step.ask({ id: "approve-stack", question: "Approve TECH_STACK.md?",
               contextFrom: ["tech-stack"] }),

    step.prompt({ id: "skills", promptFile: "05_skills.md",
                  contextFrom: ["tech-stack"],
                  tools: ["Read","Write","Bash","Task"],
                  handoff: "skills_index" }),
    step.script({ id: "skill-lint", cmd: "scripts/skill-linter.mjs" }),

    step.prompt({ id: "prd", promptFile: "06_prd.md",
                  contextFrom: ["brief","architecture","tech-stack"],
                  handoff: "prd" }),
    step.ask({ id: "approve-prd", question: "Approve PRD.md?",
               contextFrom: ["prd"] }),

    step.script({ id: "commit", cmd: "scripts/commit-sdlc-init.sh" })
  ]
})
```

The `skills` step is one Claude invocation that reads the tech stack and authors all required skills. Internally it spawns `Task(subagent_type="skill-author")` once per skill, in parallel where useful — but to Relay it is a single step. This sidesteps the constraint that `step.parallel` branches must be known at flow-definition time (the skill list is data-dependent on the chosen tech stack).

### 7.2 `planning` — plan a feature

**Input:** path to `FEATURE-*.md`.
**Output:** `.planning/sprints/sprint-*.json`.

```ts
defineFlow({
  name: "planning",
  steps: [
    step.script({ id: "intel-refresh", cmd: "scripts/intel-refresh.sh" }),

    step.prompt({ id: "read-brief", promptFile: "01_brief.md", handoff: "brief" }),
    step.prompt({ id: "brainstorm", promptFile: "02_brainstorm.md",
                  contextFrom: ["brief"], handoff: "enriched_brief" }),

    step.branch({
      id: "needs-arch", cmd: "scripts/needs-architecture.sh",
      onExit: { "0": "compose-tasks", "1": "extend-arch" }
    }),
    step.prompt({ id: "extend-arch", promptFile: "03_arch.md",
                  contextFrom: ["enriched_brief"], handoff: "architecture" }),
    step.ask({ id: "approve-arch", question: "Approve architecture changes?",
               contextFrom: ["extend-arch"] }),

    step.prompt({ id: "compose-tasks", promptFile: "04_compose_tasks.md",
                  contextFrom: ["enriched_brief","architecture"],
                  handoff: "tasks" }),
    step.prompt({ id: "compose-waves", promptFile: "05_compose_waves.md",
                  contextFrom: ["tasks"], handoff: "waves" }),
    step.prompt({ id: "compose-sprints", promptFile: "06_compose_sprints.md",
                  contextFrom: ["waves"], handoff: "sprints" }),

    step.prompt({ id: "verify-coverage", promptFile: "07_verify.md",
                  contextFrom: ["enriched_brief","sprints"],
                  handoff: "coverage_report" }),

    step.script({ id: "write-sprints", cmd: "scripts/write-sprint-files.sh" })
  ]
})
```

`compose-tasks → compose-waves → compose-sprints` are sequential single-output steps because Relay produces one handoff per step. The planner is one logical actor split across three steps; this also gives Relay step-level resume granularity at each sub-stage. `verify-coverage` is the gate from §5.2: every feature acceptance bullet must map to ≥1 task verification gate, or the flow fails before writing sprint files.

### 7.3 `sprint-implementation` — execute a sprint

**Input:** `--sprint sprint-001 --repo owner/name`.
**Output:** PR on GitHub, `report.html`, `retro.md`.

```ts
defineFlow({
  name: "sprint-implementation",
  steps: [
    step.script({ id: "branch", cmd: "scripts/sprint-branch.sh" }),
    step.script({ id: "load-state", artifact: "state.json",
                  cmd: "scripts/load-state.sh" }),

    step.prompt({ id: "plan-execution", promptFile: "01_plan_execution.md",
                  contextFrom: ["load-state"], handoff: "execution_plan" }),

    step.loop({
      id: "wave-loop",
      body: [
        step.prompt({
          id: "wave",
          promptFile: "02_wave.md",
          contextFrom: ["execution_plan"],
          tools: ["Read","Write","Edit","Bash","Glob","Grep","Task"],
          handoff: "wave_result"
        }),
        step.script({ id: "wave-commit", cmd: "scripts/wave-commit.sh" })
      ],
      until: { from: "wave_result", path: "$.all_waves_done", equals: true },
      maxIterations: 20
    }),

    step.prompt({ id: "retro", promptFile: "03_retro.md",
                  contextFrom: ["wave_result"], handoff: "retro" }),
    step.script({ id: "report", cmd: "scripts/build-report.sh" }),
    step.script({ id: "pr",     cmd: "scripts/open-pr.sh" })
  ]
})
```

The `wave` step is the load-bearing one. It is a single `step.prompt` running the **wave-runner role**: read the next wave from `execution_plan`, fan out builder subagents via `Task`, run the reviewer subagent on the wave, retry failed tasks per `task.on_fail`, and emit `wave_result` including `all_waves_done`.

Why one prompt step, not nested Relay structures:

- `step.parallel` is forbidden inside `step.loop`, but a wave fans out an unknown number of tasks.
- Nested loops are forbidden, but failure handling needs a per-task retry loop inside the wave.
- Both forms of dynamism live naturally inside Claude Code via `Task`. Relay sees one step per wave — exactly the granularity needed for atomic per-wave commits and resumable per-wave checkpoints.

The wave-runner agent (`.claude/agents/wave-runner.md`) reads `.planning/state/<sprint_id>.json` on entry so that re-running a partially-completed wave skips already-finished tasks. The `step.script wave-commit` produces the atomic per-wave conventional commit (`feat(scope): wave-N — <title>`).

### 7.4 `intel-refresh` — maintenance

A cheap flow that runs the `intel-keeper` role only. Triggered by humans, by `loop`, or by a hook on merge to main.

```ts
defineFlow({
  name: "intel-refresh",
  steps: [
    step.prompt({ id: "diff", promptFile: "01_diff.md",
                  tools: ["Read","Glob","Grep","Bash"], handoff: "diff_report" }),
    step.prompt({ id: "patch", promptFile: "02_patch.md",
                  contextFrom: ["diff_report"],
                  tools: ["Read","Write","Edit","Bash"], handoff: "patched" })
  ]
})
```

---

## 8. State, resumability, checkpoints

`.planning/state/<sprint_id>.json`:

```json
{
  "sprint_id": "sprint-001",
  "current_wave": "wave-3",
  "wave_status": {
    "wave-1": "done",
    "wave-2": "done",
    "wave-3": "in_progress"
  },
  "task_status": {
    "task-7f2a": "done",
    "task-9c1b": "in_progress",
    "task-3e8d": "todo"
  },
  "in_flight": [
    { "task_id": "task-9c1b", "agent_id": "builder-2", "started_at": "...", "pid": null }
  ],
  "last_commit_sha": "abc123",
  "checkpoints": [
    { "at": "...", "wave": "wave-2", "sha": "abc123" }
  ]
}
```

**Recovery rules** when a sprint flow restarts:

1. If `last_commit_sha` matches `HEAD`, repository is clean — resume from `current_wave`.
2. If repository is dirty, the recovery is treated as an incident: `git stash` the dirty state, hand control to a human via `step.ask` with the diff attached.
3. Tasks marked `in_progress` are restarted from scratch unless the builder wrote a partial-result marker (`.planning/state/<sprint_id>/<task_id>.partial`).
4. Waves marked `done` are never re-run.

Session-limit recovery is the same code path as crash recovery. There is no special case.

---

## 9. Failure handling

Failure modes and their fixed policies.

| Mode | Detection | Default policy |
|---|---|---|
| Builder produces failing verification | reviewer wave | flake-retry first (§9.1); then real retry (≤ `task.max_attempts`); on exhaustion apply `on_fail` |
| Builder runs out of context | builder self-reports `partial.json`; orchestrator detects via Task return | split task → re-plan; fail wave; resume from the partial |
| Builder edits files outside `target_files` | reviewer audit | warning (recorded in finding); revert only if the touch breaks unrelated tests |
| Contract turns out wrong (downstream wave fails) | reviewer wave | fail sprint; planner re-plans contract + dependent waves |
| Reviewer can't run gates (env broken) | reviewer | pre-flight should have caught this; if not, escalate immediately |
| Wave-runner orchestrator dies mid-wave | Relay restart | resume from `.planning/state/<sprint_id>.json`; skip `done` tasks; restart `in_progress` from scratch |
| `step.ask` times out (human unavailable) | Relay | sprint pauses indefinitely; on resume, re-asks |

`on_fail` values:

- `retry` — already covered by `max_attempts`; this is for the next layer (e.g. retry with a *different* skill set).
- `escalate` — write `.planning/blocked/<sprint_id>/<task_id>.md` with full diagnostic, mark task `blocked`, continue other tasks in the wave, fail the sprint at end.
- `skip` — mark task `skipped`, continue. Only valid for tasks tagged `optional: true`.

**Rollback semantics.** Per-wave commits mean rollback is `git reset --hard <last_good_wave_sha>`. The orchestrator never amends; it only adds new commits. Failed waves leave a `failed-wave-{id}.md` artifact in the PR for human review.

### 9.1 Flake handling

Real test suites are flaky. The reviewer must distinguish "actually broken" from "transient." Policy:

- For each gate command, the reviewer reads the historical `flake_rate` from `estimation_priors.json → verification_failure_modes`.
- If `flake_rate > 0.02` AND the gate is `tests` (only tests get this — lint/build are deterministic), the reviewer re-runs the failing command up to **2** times before recording a real failure.
- Each flaky pass is logged: `gates[].flake_retries: 1`. Retros use this signal to recommend test fixes.
- If a flake-retry succeeds, the verdict is `pass` but with `flaky: true` so the PR body surfaces it.

This is gated by intel — if `verification_failure_modes` has no entry for the command, no flake-retries run. New flake data accrues by observing failures over time.

### 9.2 Notification path

Without notification, blocked sprints sit silent. When a sprint blocks (any task hits `escalate`):

1. Wave-runner writes `.planning/blocked/<sprint_id>/<task_id>.md` with: full task spec, last-attempt diagnostic, file diff snippet, suggested human action.
2. Wave-runner appends a one-line entry to `.planning/blocked/INDEX.md`.
3. The `sprint-implementation` flow's `pr` step adds a `BLOCKED` label and pins a comment listing all blocked tasks at the top of the PR description.
4. Optional: a hook (`.claude/settings.json`) on `Stop` can fire a webhook (Slack, email) — out of scope for this spec but worth wiring per project.

The PR is opened *even when blocked* so humans see the partial result rather than nothing.

### 9.3 Pre-flight check

The first step of `sprint-implementation` runs `scripts/preflight.sh` which verifies:

- Git state: clean working tree on the parent branch, no uncommitted changes.
- Tools: every command referenced in `build-graph.json` is on `PATH`.
- Deps: `pnpm install --frozen-lockfile` (or stack-equivalent) succeeds.
- Auth: `gh auth status` returns 0.
- Sprint plan validates against the schema (§19.1).

Pre-flight failures abort the sprint *before* any code is written. Cheap insurance.

### 9.4 Idempotency rules

Every step is restartable. Specifically:

- `step.script` calls must be idempotent (`scripts/wave-commit.sh` checks if the wave is already committed and exits 0 if so).
- The wave-runner reads `.planning/state/<sprint_id>.json` first thing on every entry; tasks marked `done` are skipped.
- Builders read `task.target_files.create` and skip creation if the file already exists *and* matches expected content (hash check).
- `gh pr create` is replaced by `gh pr create --draft || gh pr edit` so re-runs don't error.

---

## 10. Review and verification

The `reviewer` agent has two distinct jobs.

### 10.1 Mechanical verification (must run, blocking)

For each task in the wave, the reviewer runs every command in `task.verification`. Output is `review-{wave_id}.json`:

```json
{
  "wave_id": "wave-3",
  "tasks": [
    {
      "task_id": "task-7f2a",
      "gates": [
        { "kind": "tests", "cmd": "pnpm test --filter resource", "exit": 0, "duration_ms": 4321 },
        { "kind": "lint",  "cmd": "pnpm lint",                   "exit": 0 }
      ],
      "verdict": "pass"
    }
  ],
  "verdict": "pass"
}
```

Any non-zero gate fails the task and triggers retry per §9.

### 10.2 Cross-cutting audit (advisory, structured)

Loaded skills: `code-reviewing` plus security/perf/architecture skills as the sprint demands. Output is structured findings, not prose:

```json
{
  "findings": [
    {
      "id": "F-001",
      "severity": "blocking" | "high" | "medium" | "low" | "info",
      "category": "security" | "architecture" | "performance" | "duplication" | "style",
      "file": "src/modules/resource/resource.service.ts",
      "line": 142,
      "summary": "Soft-delete check missing in list query",
      "suggested_fix": "Filter `deletedAt: null` in `findAll` query",
      "auto_fixable": true
    }
  ]
}
```

`blocking` findings stop the sprint and are routed back to the builder loop (or to a human if `auto_fixable: false`). `high` and below land in the PR body for human review but do not block.

### 10.3 Why prose review is not enough

A free-text review like "looks good but consider X" cannot drive a deterministic loop. Structured findings let the orchestrator decide automatically: *blocking + auto_fixable* → spawn a builder to fix; *blocking + not auto_fixable* → escalate to human; *non-blocking* → annotate PR.

### 10.4 Output validation

LLM output is sometimes malformed. The reviewer's findings are validated by `scripts/validate-review.mjs` before they're consumed:

- Schema check: every finding has required fields with valid enum values.
- Coordinates check: `file` paths exist; `line` is within the file.
- Severity check: at most 5 `blocking` findings per wave (more than that means the reviewer is panicking; fail the wave and re-prompt).

Failures from the validator bounce the reviewer once with a corrective prompt that includes the validator's error message. Second failure → escalate.

### 10.5 Smoke wave

Per-wave gates pass on individual modules. They miss integration regressions. The planner appends one final wave to every sprint:

```json
{
  "id": "wave-smoke",
  "kind": "review",
  "tasks": [{
    "id": "task-smoke",
    "title": "Smoke verification",
    "verification": {
      "tests":  ["pnpm test"],
      "lint":   ["pnpm lint"],
      "build":  ["pnpm build"],
      "custom": []
    },
    "skills": [],
    "estimate_tokens": 3000
  }]
}
```

The smoke wave runs the *full* suites from `build-graph.json → smoke`. A green smoke wave is the only thing that lets the sprint produce a non-blocked PR.

---

## 11. Learning loop

After every sprint the reviewer produces **two** retro artifacts: a human-readable narrative and a machine-readable patch. The patch is what actually drives improvement.

### 11.1 Human-readable retro

`.planning/retros/sprint-{id}.md`:

```markdown
# Retro: sprint-001

## Estimation accuracy
- task-7f2a: estimated 18k, actual 24k (+33%) — under-estimated; soft-delete touched 3 services
- task-9c1b: estimated 8k, actual 6k (-25%) — over-estimated

## Skills
- typescript: useful in 4/4 tasks
- prisma: only used in 1 task; consider scoping

## Wave invariants
- wave-3 hit target_files conflict between task-9c1b and task-3e8d (planner missed shared util)
  → Add util-file detection heuristic to sprint-planning skill

## Recommendations for next sprint
- ...
```

This is for humans reading the PR.

### 11.2 Machine-readable patch

`.planning/retros/sprint-{id}.priors-patch.json` — the schema in §5.5. The reviewer derives this from the sprint's `actuals` field on every task:

```js
for (task of sprint.tasks) {
  ratio = task.actuals.tokens_used / task.estimate_tokens
  for (skill of task.skills) {
    patch.skill_multipliers[skill].delta_n     += 1
    patch.skill_multipliers[skill].delta_ratio_sum += ratio
  }
  patch.model_multipliers[task.model].delta_n     += 1
  patch.model_multipliers[task.model].delta_ratio_sum += ratio
}
```

`scripts/merge-priors.mjs` then folds the patch into `.planning/estimation_priors.json` deterministically (running mean, stddev, n).

The next planner run reads `estimation_priors.json` to pick `final_estimate` per the formula in §5.5. The LLM never directly rewrites priors — it only emits patches that pass schema validation.

### 11.3 Wave-invariant learning

When the reviewer detects a wave-invariant violation (target_files conflict, contract churn, etc.), it emits a `wave_invariant_hints_add` entry with:
- `pattern`: a regex describing the file-set the violation involved
- `advice`: what the planner should do differently
- `evidence_sprints`: the sprint where this was observed

After 3 sprints' evidence, the hint graduates from "suggested" to "enforced" — the plan validator (§19.2) starts blocking plans that violate it.

This is the only mechanism that makes the planner less stupid over time. Without it the system is stateless and repeats every mistake.

---

## 12. Git, branching, PRs

- `sdlc-init` lands on `sdlc/init`, single PR.
- Each sprint creates `sprint/<id>-<slug>` from `main` (or from the team's working base).
- Each wave is one atomic commit. Conventional message: `feat(<scope>): wave-<n> — <wave title>`.
- The PR is opened only at the *end* of the sprint, not incrementally. PR body is auto-composed:
  - Sprint summary
  - Per-wave summary table
  - Verification report (link to `review-*.json`)
  - Non-blocking findings (high/medium)
  - Open issues / blocked tasks (`BLOCKED-*.md`)
  - Retro link
- Conflicts on rebase against `main` follow `version-control` skill: agent attempts trivial conflicts; non-trivial conflicts escalate to human.
- Force pushes are forbidden in the SDLC flows. Fixups are normal commits.

### 12.1 Multi-developer coordination

Humans can run sprints in parallel because each sprint is a branch. To prevent metadata conflicts:

- **Sprint IDs are reserved.** Before planning, `scripts/reserve-sprint-id.sh` claims the next ID by atomically appending to `.planning/sprints/.reserved` on `main`. Two humans planning at once won't collide.
- **`.planning/state/<sprint_id>.json` is per-sprint.** No cross-sprint contention.
- **`INTEL.md` and `.planning/intel/` conflicts on merge resolve mechanically.** A post-merge hook (`.git/hooks/post-merge`) re-runs `relay run intel-refresh` if any commit on the merged branch changed >5% of the codebase. Humans don't hand-resolve intel conflicts.
- **`.planning/estimation_priors.json` uses the patch model (§11.2).** Two parallel sprints each emit a `priors-patch.json`; both are merged into `estimation_priors.json` on `main` after PR merge, in order. No interactive merge.
- **`.claude/skills/INDEX.json`** can conflict if two sprints add skills. Resolution: skill additions land in dedicated `skills/` PRs separate from feature work, so feature PRs never touch `INDEX.json`.

Practical guidance: a team should not run more than 2–3 concurrent sprints. Beyond that, INTEL refresh churn dominates.

---

## 13. Human-in-the-loop boundaries

Hard boundaries — humans are always required:

| Decision | Why |
|---|---|
| Initial feature/application brief | Source of truth; AI cannot invent intent |
| Architecture choice on `sdlc-init` | Long-lived, structural |
| Tech stack choice on `sdlc-init` | Long-lived, structural |
| New skill merge | Prevents skill creep |
| Resolving `blocking` + `auto_fixable: false` review findings | Judgment call |
| Anything requiring credentials, env vars, infra access | AI permissions |
| Force-push, branch deletion, merge to main | Destructive |

Soft boundaries — humans optional:

- Brainstorm rounds (`step.ask` ≤ 3 rounds; humans can accept early)
- Architecture/tech-stack approval when reusing existing
- Non-blocking review findings

Everything else runs without prompting.

---

## 14. Concrete agent definitions

Full system prompts for each subagent. Place under `.claude/agents/<name>.md`.

### 14.1 `wave-runner` (load-bearing — implement this carefully)

```markdown
---
name: wave-runner
description: Orchestrates a single wave. Spawns N parallel builders, runs the reviewer, applies retry policy, emits wave_result. Reads/writes .planning/state/<sprint>.json.
model: opus
tools: [Read, Write, Edit, Bash, Glob, Grep, Task]
skills: [version-control, verification-gates]
---

You are the wave-runner. You orchestrate exactly one wave per invocation.

INPUT (from your spawn prompt):
- sprint_id: string
- wave_id: string
- execution_plan: object — the full sprint plan as JSON
- state_path: string — path to .planning/state/<sprint_id>.json

PROCEDURE (do these in order, do not skip steps):

1. Read state_path. Identify task_status for every task in this wave.
   - tasks already "done" → skip.
   - tasks "in_progress" → reset to "todo" (assume the prior attempt was lost).
   - tasks "blocked" → leave as is, do not retry.

2. Read the wave from execution_plan. Validate target_files disjointness across todo tasks one more time. If invariants are now violated (intel changed since planning), abort and write a partial state with reason="invariant_violation_at_runtime".

3. Spawn one Task per todo task IN PARALLEL (single message, multiple Task tool uses):
   - subagent_type: "builder"
   - prompt: full task JSON + reference to .planning/state path + reminder of skill names to Read

4. Wait for all builders to return. For each:
   - record actuals.tokens_used, files_touched, summary
   - if returned with verification all-green → mark task_status=done
   - if returned with partial.json → mark blocked, write diagnostic to .planning/blocked/
   - if returned with verification failures → store and continue (retry decision after all tasks return)

5. After all builders returned, identify failed tasks. For each:
   - Apply flake-retry per §9.1 (re-run failing test gates only).
   - If still failing AND attempts < max_attempts: spawn a fresh builder Task with the failure diagnostic prepended. Retry once.
   - If still failing AND attempts == max_attempts: apply on_fail (escalate / skip).

6. Spawn the reviewer Task on the wave:
   - subagent_type: "reviewer"
   - prompt: wave JSON + paths to changed files + verification results from builders
   - Reviewer produces review-{wave_id}.json (mechanical) and findings-{wave_id}.json (audit).

7. Validate the reviewer's output via Bash: `node scripts/validate-review.mjs <findings-path>`.
   - If invalid: re-spawn reviewer with the validator's error. One retry. Then escalate.

8. If any blocking + auto_fixable findings: spawn one builder Task per fix. Same retry envelope.

9. Update state_path with final task_status. Compute all_waves_done = (next wave does not exist).

10. Return wave_result JSON:
    {
      wave_id,
      verdict: "pass" | "blocked" | "failed",
      tasks_done: [...],
      tasks_blocked: [...],
      tasks_failed: [...],
      tokens_used_total,
      all_waves_done: boolean,
      findings_summary: { blocking, high, medium, low, info }
    }

INVARIANTS YOU MUST UPHOLD:
- Never edit code yourself. You are an orchestrator. Only Task children edit code.
- Never commit. The wave-commit step.script is responsible.
- Never modify state_path between Task spawns and Task returns. State updates happen at clear checkpoints (steps 1, 4, 5, 9).
- Idempotency: re-entering this prompt mid-wave must produce the same final state given the same task outcomes. Always re-read state_path at entry.

CONTEXT BUDGET:
- Your context is bounded. If wave has >6 tasks, summarize each builder's return to ≤500 tokens before storing.
- If you observe your own context fill above ~70%, write a partial state and exit early with verdict="partial".
```

### 14.2 `builder`

```markdown
---
name: builder
description: Implements a single task. Loads task-specified skills via Read on .claude/skills/*/SKILL.md.
model: sonnet  # overridden per task
tools: [Read, Write, Edit, Bash, Glob, Grep]
skills: [version-control]
---

You are a builder. You receive one task as JSON.

ON ENTRY:
1. For each skill_name in task.skills: Read .claude/skills/<skill_name>/SKILL.md.
2. Read every file in task.references.
3. Read INTEL.md sections referenced in task.context.

WORK:
4. Implement task.description. Stay within task.target_files.{create,update,remove}.
   - You MAY touch files in task.target_files.may_also_touch without warning.
   - You MAY touch other files if implementation requires (record in your summary; reviewer will warn).
   - You MAY NOT modify files in .planning/sprints/*/contracts/ (frozen).
5. Write tests as you go, in the test_path defined in INTEL.

VERIFICATION:
6. Run every command in task.verification. If any fails: read the output, fix, re-run. Up to 3 attempts.
7. If all verification passes: return success.
8. If verification still fails after 3 attempts: return failure with diagnostic.

CONTEXT-LIMIT FALLBACK:
9. If you observe your context filling above ~80%: write `.planning/state/<sprint_id>/<task_id>.partial` with current diff summary, files-touched list, and what's left to do. Return early with verdict="partial".

OUTPUT (return value, JSON):
{
  task_id,
  verdict: "pass" | "fail" | "partial",
  files_touched: [...],
  out_of_scope_touches: [...],   # files outside target_files you had to edit
  tokens_used: number,
  verification_results: [ { kind, cmd, exit, duration_ms, flake_retries } ],
  summary: string,                # ≤500 tokens for wave-runner consumption
  diagnostic: string              # only on fail/partial
}
```

### 14.3 `reviewer`

```markdown
---
name: reviewer
description: Runs verification gates and emits structured findings for a wave.
model: opus
tools: [Read, Bash, Glob, Grep]
skills: [code-reviewing]
---

You are a reviewer. You receive a wave JSON and the list of changed files.

PHASE 1 — MECHANICAL:
1. For each task in the wave, run every command in task.verification via Bash.
2. Apply flake-retry per .planning/estimation_priors.json verification_failure_modes (test gates only, max 2 retries).
3. Emit review-{wave_id}.json with the schema in §10.1.

PHASE 2 — AUDIT:
4. For each changed file, read it. Apply checks from your loaded skills (security, architecture, perf, duplication, style).
5. Cross-check against task.target_files: any file edited that's not in target_files.create/update/may_also_touch produces an info-severity finding.
6. Cross-check against ARCHITECTURE.md for layering violations.

OUTPUT:
- review-{wave_id}.json (mechanical, schema in §10.1)
- findings-{wave_id}.json (audit, schema in §10.2)

CONSTRAINTS:
- Never edit code. Read-only + Bash only.
- Never produce prose-only output. Always emit the structured JSON files.
- At most 5 blocking findings per wave. If you have more, you are panicking — reduce severity or fail the wave with verdict="reviewer_overload".
```

### 14.4 `planner`

```markdown
---
name: planner
description: Composes tasks/waves/sprints from feature briefs. Reads INTEL and estimation_priors.
model: opus
tools: [Read, Write, Glob, Grep]
skills: [sprint-planning]
---

You are the planner. You receive a feature brief and INTEL.md/build-graph.json/estimation_priors.json.

PROCEDURE:
1. For each requirement in the brief, propose 1..N tasks following §5.1.1 derivation rules.
2. Compute target_files conservatively (smallest plausible set). Add hot-files to may_also_touch.
3. Derive task.verification strictly from build-graph.json. If a needed command is absent, abort and surface via step.ask.
4. Pick task.skills from .claude/skills/INDEX.json. Cap at 4 per task.
5. Estimate tokens using §15 base × estimation_priors.json multipliers.
6. Build dependency graph by static analysis of imports/exports.
7. Group into waves enforcing §5.2 invariants. Reject any wave that violates them; revise.
8. Append a smoke wave (§10.5) as the final wave of every sprint.
9. Group into sprints by orchestrator_token_budget.
10. Cross-check coverage: every brief acceptance bullet maps to ≥1 task verification gate. Emit coverage_report.

OUTPUT: tasks.json, waves.json, sprint-{id}.json files.

NEVER:
- Invent verification commands not in build-graph.json.
- Reference skills not in INDEX.json.
- Produce a sprint with target_files conflicts within any wave.
- Skip the smoke wave.
```

### 14.5 `intel-keeper`

```markdown
---
name: intel-keeper
description: Builds and updates INTEL.md and .planning/intel/ files.
model: sonnet
tools: [Read, Write, Glob, Grep, Bash]
skills: [codebase-mapping]
---

You are the intel-keeper. You produce a precise codebase summary.

ON FRESH RUN (no .planning/intel/.snapshot):
1. Glob the repo for source files. Identify language(s) and package manager from manifest files.
2. Build modules.json, build-graph.json, conventions.md, hot-files.md, test-layout.md, schema.md per §4.1 schemas.
3. Write INTEL.md as a top-level summary that links into the .planning/intel/ files.
4. Write .planning/intel/.snapshot = `git rev-parse HEAD`.

ON DIFF RUN (snapshot exists):
1. Compute `git diff <snapshot>..HEAD --name-only`.
2. For each changed file: identify which intel file it would affect.
3. Patch only those files.
4. Update .snapshot to current HEAD.

OUTPUT: writes to docs/INTEL.md, .planning/intel/*, .planning/intel/.snapshot.

NEVER:
- Invent commands; derive from manifests.
- Speculate about modules that don't exist.
- Rewrite intel files when nothing has changed.
```

### 14.6 `brainstormer`

```markdown
---
name: brainstormer
description: Fills gaps in feature briefs through directed questions. Bounded to ≤3 rounds.
model: opus
tools: [Read]
skills: [brain-storming]
---

You are the brainstormer. Your job: turn a vague brief into an unambiguous one.

PROCEDURE:
1. Read the brief, INTEL.md, ARCHITECTURE.md, PRD.md.
2. Identify gaps using your skill's gap-checklist (auth, data model, error paths, performance constraints, UI scope, success metrics).
3. Output ≤4 directed questions per round. Each question:
   - has a recommended answer based on project context
   - ≤2 sentences
   - is genuinely blocking (not nice-to-know)
4. After ≤3 rounds, write enriched_brief.md with all gaps filled.

NEVER:
- Ask questions whose answers are already in the brief or INTEL.
- Ask >4 questions in one round.
- Continue past round 3 — produce best-effort enriched brief instead.
```

### 14.7 `skill-author`

```markdown
---
name: skill-author
description: Creates a new skill package under .claude/skills/<name>/.
model: opus
tools: [Read, Write, Bash, WebFetch]
skills: [skill-authoring]
---

You are a skill-author. You produce one skill per invocation.

INPUT: skill_name, domain (language|framework|data|api|testing|infra), tech-stack context.

PROCEDURE:
1. Web-research official docs for the domain target (if domain library exists).
2. Write .claude/skills/<skill_name>/SKILL.md (≤5k tokens) covering: overview, core patterns, common pitfalls, project conventions.
3. Write references/<topic>.md files for deeper material.
4. Append entry to .claude/skills/INDEX.json (atomic — read, append, write).

NEVER:
- Exceed 5k tokens in SKILL.md.
- Duplicate an existing skill's domain (check INDEX.json first).
- Reference external URLs in SKILL.md (cache content locally).
```

---

## 15. Token-budget heuristics & cost attribution

### 15.1 Default budgets

| Scope | Budget |
|---|---|
| Single builder task | ≤ 25k tokens (target), ≤ 50k (hard cap) |
| Single wave | ≤ 200k tokens summed across builders |
| Single wave-runner orchestrator | ≤ 80k tokens (separate from the sum of builders) |
| Single sprint orchestrator | ≤ 150k tokens |
| Sprint total (orchestrator + all builders + reviewer) | tracked, no hard cap; informs splitting |

### 15.2 Cold-start estimation primitives

- read 1 file ≈ `tokens(file)` where `tokens(file) ≈ chars(file) / 4`
- write/edit a file ≈ `0.3 × tokens(file)` for partial edits, `1.0×` for new file
- run a verification gate ≈ 1k tokens (agent reads the result, not the gate output unless failed)
- skill load ≈ `size_tokens` from `INDEX.json`
- spawn one Task subagent ≈ 2k tokens of orchestrator overhead per child

Apply `estimation_priors.json` multipliers (§5.5) to refine these.

### 15.3 Per-task cost attribution

Relay rolls all `Task` subagent token usage into the parent step's metric. To get per-task cost, the wave-runner emits its own log:

`.planning/state/<sprint_id>/cost.jsonl` (append-only):

```jsonl
{"task_id":"task-7f2a","attempt":1,"model":"sonnet","tokens_in":12300,"tokens_out":4200,"cost_usd":0.067,"started_at":"...","ended_at":"..."}
{"task_id":"task-9c1b","attempt":1,"model":"sonnet","tokens_in":8100,"tokens_out":2400,"cost_usd":0.039,"started_at":"...","ended_at":"..."}
```

The wave-runner reads `tokens_used` from each builder's return value (which builders self-report from their context window state) and appends one line per attempt. Retros consume this file to compute `actuals.tokens_used` per task.

This is the only mechanism that produces the data `estimation_priors.json` learns from. Without it, the retro has nothing to feed back.

---

## 16. Scope

### 16.1 Explicit v1 deferrals

These are part of the eventual system but are deferred until the basic loop works in practice:

- **Contract waves.** Disabled by default; the gate in §5.4 keeps them rare. Re-evaluate once interface drift becomes a measurable cost.
- **Strict `target_files` enforcement.** v1 treats it as advisory (warning-on-violation, not revert). Promote to strict only after retros show this causes problems, not before.
- **Auto-fix for blocking findings.** v1 escalates all blocking findings to humans; auto-fix loops add complexity and can spiral. Add once review findings are reliably structured (§10.4).
- **Multi-skill blending.** v1 caps `task.skills` at 4. Cross-domain tasks that need >4 are split, not blended.
- **Live observability hooks.** v1 reports through the PR; webhooks (Slack, etc.) are project-specific add-ons via `.claude/settings.json` hooks.
- **Dynamic model promotion.** v1 picks model at planning time. A future feature could promote a task from Sonnet to Opus mid-flight after a failure; not yet.

### 16.2 Out of scope (won't ever be in this design)

- **Real-time pair programming.** The model is asynchronous and artifact-based.
- **Cross-repo refactors.** One sprint = one repository.
- **Live production debugging.** The SDLC ships code; observability/incident response is a separate system.
- **Non-code artifacts beyond docs.** Design assets, marketing copy, etc.

---

## 17. Quickstart for a user

```
1. Clone the starter repo (agents + skills + relay flow definitions).
2. Drop a START.md in the project root.
3. relay run sdlc-init
   → review and approve ARCHITECTURE.md, TECH_STACK.md, PRD.md
   → merge sdlc/init PR
4. Write a feature brief: .planning/features/FEATURE-<name>.md
5. relay run planning --input .planning/features/FEATURE-<name>.md
   → review proposed sprints in .planning/sprints/
6. (FIRST TIME ONLY) relay run sprint-implementation --sprint sprint-001 --dry-run
   → executes the wave-runner against ONE wave with ONE task; verifies the loop works end-to-end
7. relay run sprint-implementation --sprint sprint-001 --repo owner/name
   → review the PR; merge.
8. relay run intel-refresh   # optional, on demand
```

The `--dry-run` mode in step 6 is the bootstrap path (§21). Skip it once you trust the pipeline; never skip it on a fresh project.

---

## 18. Differences from `AGENTIC_SDLC_IDEA.md`

For traceability:

| Idea doc | This doc | Reason |
|---|---|---|
| `acceptance_criteria: ""` (prose) | `verification: { tests, lint, build, files_exist, custom }` | Mechanical gates remove ambiguity from the loop. |
| "Compose logic and test tasks in parallel" | Tests live inside the same task as the logic, or in a downstream wave that depends on it | Tests verify logic; parallelism between them is unsafe. |
| "Everything is a task" | Anything that needs verification, parallelism, or a different skill is a task | Avoids coordination overhead on trivial work. |
| "AI agents cannot communicate with each other" | Reframed: agents communicate asynchronously via filesystem artifacts | The premise was wrong; the filesystem *is* the bus. |
| Explore step | First-class `INTEL.md` + `.planning/intel/`, refreshed by diff | Prevents repeated discovery cost. |
| No contract step | `kind: "contract"` waves emit immutable interface artifacts before dependent build waves | Prevents parallel agents from disagreeing on shapes. |
| No retro | Per-sprint `retro.md` consumed by next planning run | Only mechanism by which the system improves over time. |
| Failure handling implicit | `max_attempts`, `on_fail`, BLOCKED-*.md, structured review findings | Loop needs deterministic exits. |
| Single model | `model` field per task (Opus/Sonnet/Haiku) | Cost and latency depend on task difficulty. |
| Skill list | Skill registry (`INDEX.json`) + linter + human-merge | Prevents skill creep from `skill-author`. |
| Sprint = bag of waves | Sprint also carries `orchestrator_token_budget`, gets split when too large | Orchestrator context is the second scarcity, not just builder context. |
| Sprint loop with parallel waves directly in Relay | Wave loop where each iteration is one `step.prompt`; builders fan out via `Task` inside Claude | Relay forbids `step.parallel` inside `step.loop`; dynamic parallelism is delegated to Claude. |
| Skill-author fan-out via Relay | Single `step.prompt` that spawns `Task(skill-author)` per skill | `step.parallel` branches must be predetermined at flow-definition time; the skill list is data-dependent on the chosen tech stack. |
| Multiple outputs from one planner step | Sequential planner steps, one handoff each | Relay produces one output per `step.prompt`. |
| Implicit single state file | Two-layer state: Relay run state (`.relay/runs/`) + SDLC state (`.planning/state/`) | Relay tracks step-level resume per invocation; the SDLC needs task-level resume across many invocations. |
| Flow composition assumed | Each phase is its own `relay run`; chaining is via filesystem artifacts under `docs/` and `.planning/` | Relay does not support sub-flows. |

---

## 19. Validators

The system runs cheap deterministic checks at three points to catch LLM mistakes before they cascade. Validators are **scripts**, not LLM calls — they fail fast and produce structured errors the LLM can react to.

### 19.1 Plan validator — `scripts/validate-plan.mjs`

Runs after the planning flow, before sprint files are written. Inputs: tasks.json, waves.json, sprint-*.json. Checks:

| Check | Rule | On fail |
|---|---|---|
| Task IDs unique | every `task.id` distinct | abort plan |
| Skill names exist | every entry in `task.skills` is in `INDEX.json` | abort plan |
| Verification commands exist | every command's first token is in `build-graph.json` (or is a built-in like `rg`, `node`) | `step.ask` to extend build-graph |
| Wave invariants | per §5.2: target_files disjoint (excluding may_also_touch), token sum ≤ budget | re-prompt planner with violation list |
| Smoke wave present | last wave of every sprint has `kind: review` and runs `build-graph.global.smoke` | abort plan |
| Coverage | every brief acceptance bullet maps to ≥1 task verification gate | abort plan |
| Dependency cycles | no cycles in `depends_on` graph | abort plan |
| Contract gating | no contract waves unless §5.4 conditions hold | re-prompt planner to remove |
| Hint enforcement | enforced `wave_invariant_hints` (§11.3) all satisfied | re-prompt planner |

A failed plan validator does not consume tokens to retry — the LLM gets one corrective re-prompt with the validator's structured errors as input. Second failure escalates to human via `step.ask`.

### 19.2 Review output validator — `scripts/validate-review.mjs`

Runs after every reviewer wave. Detailed in §10.4. Same one-retry-then-escalate pattern.

### 19.3 Skill linter — `scripts/skill-linter.mjs`

Runs after `sdlc-init` skill-author step. Checks:

- Every skill has SKILL.md ≤ 5k tokens.
- Every skill in `INDEX.json` exists on disk; every skill on disk is in `INDEX.json`.
- No two skills cover the same `domain` + `subdomain`.
- SKILL.md contains no http(s):// URLs (cache content locally).

### 19.4 State validator — `scripts/validate-state.mjs`

Runs at sprint resume. Checks:

- `last_commit_sha` matches `git rev-parse HEAD` OR working tree is clean and the commit is reachable.
- No task has `status: in_progress` AND `attempts[].length > max_attempts`.
- Every blocked task has a corresponding `.planning/blocked/<sprint_id>/<task_id>.md`.

State validation failure → `step.ask` with the diagnostic. Never auto-repair state.

---

## 20. Scripts contract

The flows reference shell/node scripts under `scripts/`. Each has a fixed input/output contract so they're swappable per project. Required scripts:

| Script | Input | Output | Exit codes |
|---|---|---|---|
| `scripts/preflight.sh` | `$SPRINT_ID` env | log to stdout | 0=ok, 1=tool missing, 2=dirty git, 3=auth fail, 4=plan invalid |
| `scripts/sprint-branch.sh` | `$SPRINT_ID` env, sprint json | creates+checks out branch | 0=ok, 1=branch exists |
| `scripts/load-state.sh` | `$SPRINT_ID` env | writes state.json artifact | 0=ok |
| `scripts/wave-commit.sh` | `$SPRINT_ID`, `$WAVE_ID` env | one git commit | 0=committed, 1=nothing to commit (idempotent OK), 2=git error |
| `scripts/build-report.sh` | `$SPRINT_ID` env | writes report.html | 0=ok |
| `scripts/open-pr.sh` | `$SPRINT_ID`, `$REPO` env | gh pr create or edit | 0=ok |
| `scripts/needs-architecture.sh` | feature brief + ARCHITECTURE.md | exit code routing | 0=use existing, 1=extend |
| `scripts/intel-refresh.sh` | none | runs intel-refresh flow inline | 0=updated, 1=nothing changed |
| `scripts/write-sprint-files.sh` | sprints handoff | files in `.planning/sprints/` | 0=ok |
| `scripts/reserve-sprint-id.sh` | none | new sprint ID on stdout | 0=ok |
| `scripts/merge-priors.mjs` | priors-patch.json | updates estimation_priors.json | 0=ok |
| `scripts/validate-plan.mjs` | sprint-*.json paths | structured errors on stderr | 0=ok, 1=invalid |
| `scripts/validate-review.mjs` | review-*.json + findings-*.json | structured errors on stderr | 0=ok, 1=invalid |
| `scripts/validate-state.mjs` | state.json path | structured errors on stderr | 0=ok, 1=invalid |
| `scripts/skill-linter.mjs` | none | structured errors on stderr | 0=ok, 1=invalid |
| `scripts/commit-sdlc-init.sh` | none | one git commit + branch + push | 0=ok |
| `scripts/load-start.sh` | optional `$START_MD` env | writes start.md artifact | 0=ok |

Scripts are version-controlled with the project. The starter pack ships a default implementation; projects override per their stack.

---

## 21. Bootstrap path (vertical-slice mode)

The SDLC has many moving parts. Don't trust the full pipeline before you've seen one wave end-to-end. The recommended bootstrap:

### 21.1 Dry-run mode

`relay run sprint-implementation --sprint <id> --dry-run` modifies the flow:

- The wave-loop runs **only the first wave**.
- The wave is restricted to **the first task** in that wave.
- The smoke wave is skipped.
- The PR is opened as a draft.
- Cost telemetry is emitted to stdout, not `cost.jsonl`.

This lets you see the wave-runner orchestrate one builder, see the reviewer run gates, see the wave commit. If anything is broken, you see it cheaply.

### 21.2 Calibration sprint

The first real sprint on a fresh project is a **calibration sprint**: a deliberately small feature (≤4 tasks across ≤2 waves). Its job is to seed `estimation_priors.json` with `n ≥ 5` data points before the planner relies on multipliers.

The calibration sprint should be picked from the project's actual backlog (don't fabricate work) but constrained in scope. After it merges, the priors file has real ratios for the dominant skills, and subsequent sprints use those ratios.

### 21.3 What to watch on the first sprint

| Symptom | Likely cause | First fix |
|---|---|---|
| Wave-runner runs out of context | Too many tasks per wave; orchestrator overhead under-counted | Lower `max_parallelism` in plan to 2; raise `wave-runner` budget in §15.1 |
| Builders frequently touch out-of-scope files | INTEL `modules.json` is too coarse | Refine modules; rerun intel-refresh |
| Verification commands fail to launch | `build-graph.json` is wrong | Edit by hand; the planner reads this file as truth |
| Reviewer panics with >5 blocking findings | Builders are not actually reading their skills | Check skill `Read` calls in builder transcripts; tighten builder system prompt |
| Estimates are 2x off in either direction | Cold-start priors missing | Expected; calibration sprint fixes this |

The first sprint is the design's diagnostic — treat its output as data, not a finished product.

---

## 22. State file schema

`.planning/state/<sprint_id>.json` — the canonical task-level state. Already mentioned in §8; here is the full schema for unambiguous implementation.

```json
{
  "schema_version": 1,
  "sprint_id": "sprint-001",
  "branch": "sprint/001-resource-soft-delete",
  "started_at": "2026-05-10T09:30:00Z",
  "current_wave": "wave-3",
  "wave_status": {
    "wave-1": "done",
    "wave-2": "done",
    "wave-3": "in_progress",
    "wave-4": "todo",
    "wave-smoke": "todo"
  },
  "task_status": {
    "task-7f2a": "done",
    "task-9c1b": "in_progress",
    "task-3e8d": "todo",
    "task-1a4b": "blocked"
  },
  "in_flight": [
    {
      "task_id": "task-9c1b",
      "agent_id": "builder-2",
      "started_at": "2026-05-10T11:14:32Z",
      "attempt": 1
    }
  ],
  "last_commit_sha": "abc123def",
  "checkpoints": [
    { "at": "2026-05-10T10:00:00Z", "wave": "wave-1", "sha": "111aaa" },
    { "at": "2026-05-10T10:45:00Z", "wave": "wave-2", "sha": "222bbb" }
  ],
  "blocked_tasks": [
    {
      "task_id": "task-1a4b",
      "reason": "verification failed after max_attempts",
      "diagnostic_path": ".planning/blocked/sprint-001/task-1a4b.md"
    }
  ]
}
```

**Mutations are atomic.** Wave-runner writes a temp file and renames. Concurrent reads are tolerated; concurrent writes are forbidden (only one wave-runner per sprint at a time, enforced by the Relay run's exclusive ownership).

**`wave_result` handoff** (returned from each iteration of the wave-loop):

```json
{
  "wave_id": "wave-3",
  "verdict": "pass" | "blocked" | "failed" | "partial",
  "tasks_done":    ["task-7f2a"],
  "tasks_blocked": [],
  "tasks_failed":  [],
  "tokens_used_total": 132400,
  "wall_clock_ms": 482000,
  "all_waves_done": false,
  "findings_summary": { "blocking": 0, "high": 1, "medium": 3, "low": 5, "info": 2 },
  "next_wave_id": "wave-4"
}
```

The Relay `until` condition reads `$.all_waves_done`. The wave-runner is responsible for setting this correctly when no further waves remain.

---

## 23. The starter pack

The starter pack is a versioned repository (intended to live alongside or be copy-pasted into a target project) that contains everything in §2 already populated:

```
.claude/
  agents/                     # all 7 agent definitions from §14
  skills/                     # the 7 process skills from §6.3 + INDEX.json
  settings.json               # default permissions, no project-specific hooks
docs/                         # empty templates of ARCHITECTURE/TECH_STACK/PRD/INTEL
.planning/
  features/                   # empty
  sprints/                    # empty
  state/                      # empty
  retros/                     # empty
  intel/                      # empty
  blocked/                    # empty
  estimation_priors.json      # bootstrap content (all multipliers = 1.0, n = 0)
flows/
  sdlc-init/                  # Relay flow package per §7.1
    package.json
    flow.ts
    prompts/
      01_intel.md ... 06_prd.md
    README.md
  planning/
    package.json, flow.ts, prompts/, README.md
  sprint-implementation/
    package.json, flow.ts, prompts/, README.md
  intel-refresh/
    package.json, flow.ts, prompts/, README.md
scripts/                      # all scripts from §20, with default implementations
START.md.example
README.md                     # project-level README
```

Cloning this repo into a new project is the single setup action. From there, `relay run sdlc-init` populates `docs/`, `.planning/intel/`, and any tech-stack-specific skills under `.claude/skills/`.

---

## 24. Ground truth: where to look when things break

In rough order of "where to look first":

1. `.planning/state/<sprint_id>.json` — what the system thinks is happening.
2. `.relay/runs/<run_id>/run.log` — the literal execution log of the most recent Relay run.
3. `.relay/runs/<run_id>/handoffs/` — the JSON each step produced; tells you what input the next step received.
4. `.planning/blocked/<sprint_id>/` — every blocked task with full diagnostic.
5. `.planning/state/<sprint_id>/cost.jsonl` — per-task token actuals; surfaces estimation drift.
6. `git log --oneline sprint/<id>` — what commits actually landed.
7. `docs/INTEL.md` and `.planning/intel/` — the truth the planner relied on; if this is wrong, the plan is wrong.
8. `.planning/retros/sprint-{prev}.md` and the corresponding `priors-patch.json` — what the system claims to have learned recently.

The system is designed to be inspectable from these eight files alone. If a failure can't be diagnosed from them, that's a bug in the system, not the project.
