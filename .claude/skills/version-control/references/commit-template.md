# commit-template

Reference material for `version-control` SKILL.md. Loaded on demand when an agent (or a script implementer) needs the full conventional-commit template, more worked examples, or guidance on edge cases.

## Canonical template

```
<type>(<scope>): wave-<n> — <wave title>

<optional body — one bullet per task in the wave>
- task-<id>: <task title>
- task-<id>: <task title>

<optional trailers>
BREAKING CHANGE: <description>
Refs: <FEATURE-id>
Reverts: <sha>
Co-Authored-By: <Name> <email>
```

Blank lines:

- Exactly one blank line between subject and body.
- Exactly one blank line between body and trailer block.
- No trailing blank lines after the last trailer.

Line widths:

- Subject: ≤72 characters total (including the prefix `<type>(<scope>): wave-<n> — `).
- Body: wrap at 100 characters per line. Each task bullet is one line (do not wrap a single task line).
- Trailers: never wrap a single trailer.

## Scope-picking decision tree

```
Is every task in the wave module-local?
├── No → scope = "repo"
└── Yes
    ├── Do all tasks share the same module per modules.json?
    │   ├── No → scope = "repo"
    │   └── Yes → scope = <module.name>
```

Module-local means every entry in every task's `target_files.{create,update,remove}` resolves to a single module via `modules.json` path-prefix matching. `may_also_touch` is excluded from this determination.

## Worked examples

### Example A — pure feature wave, single module

Context: wave-2 of `sprint-001`, three tasks all under `src/modules/resource/`.

```
feat(resource): wave-2 — wire soft-delete into list and detail queries

- task-7f2a: Filter deletedAt in resource.service.findAll
- task-9c1b: Filter deletedAt in resource.service.findOne
- task-3e8d: Add audit-log entry on soft-delete

Refs: FEATURE-resource-deletion
Co-Authored-By: Claude (wave-runner) <noreply@anthropic.com>
```

### Example B — cross-module wave

Context: wave-3 spans `auth` and `billing` modules; scope falls back to `repo`.

```
feat(repo): wave-3 — propagate tenant id through auth and billing

- task-aa11: Add tenantId to auth session payload
- task-bb22: Read tenantId from session in billing.service
- task-cc33: Update integration tests for tenant scoping

Refs: FEATURE-multi-tenant
Co-Authored-By: Claude (wave-runner) <noreply@anthropic.com>
```

### Example C — breaking change

Context: a `feat` wave that renames an exported type. Reviewer flagged it; planner pre-approved.

```
feat(resource): wave-1 — rename Resource.id to Resource.publicId

- task-d1e2: Rename id → publicId across resource module
- task-d3f4: Update OpenAPI schema and clients

BREAKING CHANGE: Resource.id is renamed to Resource.publicId. Clients
must update field references; serialized payloads on the wire are
unchanged.
Refs: FEATURE-resource-public-ids
Co-Authored-By: Claude (wave-runner) <noreply@anthropic.com>
```

### Example D — revert wave

Context: a prior wave introduced a regression flagged by smoke wave; planner re-planned a revert wave.

```
revert(resource): wave-5 — back out broken soft-delete service hook

- task-r0c1: Revert resource.service.softDelete added in wave-2

Reverts: 222bbb3
Refs: FEATURE-resource-deletion
Co-Authored-By: Claude (wave-runner) <noreply@anthropic.com>
```

### Example E — chore for a skills branch

Context: a `skills/playwright` branch that adds a new skill. Note this lands on a separate branch from feature work (§12.1).

```
chore(repo): wave-1 — add playwright skill package

- task-s0p1: Author .claude/skills/playwright/SKILL.md
- task-s0p2: Update .claude/skills/INDEX.json

Co-Authored-By: Claude (skill-author) <noreply@anthropic.com>
```

### Example F — sdlc-init commit

Context: produced once by `scripts/commit-sdlc-init.sh` on the `sdlc/init` branch. Single commit covering all init artifacts.

```
chore(repo): wave-1 — initialize agentic SDLC

- Add docs/ARCHITECTURE.md, docs/TECH_STACK.md, docs/PRD.md
- Add docs/INTEL.md and .planning/intel/*
- Add .claude/skills/* tech-stack-specific skills

Co-Authored-By: Claude (sdlc-init) <noreply@anthropic.com>
```

## Anti-patterns and the rules they break

| Anti-pattern | Rule violated |
|---|---|
| `Feat(Resource): wave-1 — Added soft-delete.` | type/scope must be lowercase; imperative mood; no trailing period |
| `feat(resource): wave-1 - add soft-delete` | em-dash must be U+2014, not ASCII hyphen |
| `feat: wave-1 — add stuff` | scope is required |
| `feat(resource,audit): wave-1 — …` | scope is a single token; for multi-module use `repo` |
| `feat(src/modules/resource): wave-1 — …` | scope is a module name from `modules.json`, never a path |
| `feat(resource): wave-1 — add soft-delete (rebased)` | parenthetical metadata in subject is forbidden; use trailers |
| Amended commit | rule 3: never amend |
| `feat(resource)!: wave-1 — …` | the `!` breaking-change shorthand is NOT used here; use the `BREAKING CHANGE:` trailer instead |
| Wave commit produced by anything other than `scripts/wave-commit.sh` | rule 1: only `wave-commit.sh` commits during a sprint |

## Trailer reference

| Trailer | Required when | Format |
|---|---|---|
| `BREAKING CHANGE:` | wave changes a public API in a breaking way | `BREAKING CHANGE: <description, can wrap to multiple lines>` |
| `Refs:` | feature brief has an identifier | `Refs: FEATURE-<slug>` (single ID per line; one trailer per ref) |
| `Reverts:` | type is `revert` | `Reverts: <full-sha-or-short-sha>` |
| `Co-Authored-By:` | always (project convention) | `Co-Authored-By: <Name> <email>` |

Trailer keys are case-sensitive. Git's interpret-trailers tooling recognises only the exact tokens above. Do not invent new trailer keys.

## Subject line generation algorithm

`scripts/wave-commit.sh` derives the subject deterministically:

```
1. type   = wave.commit_type            # set by the planner; default "feat"
2. scope  = derive_scope(wave.tasks)    # see "Scope-picking decision tree"
3. n      = wave.id without "wave-" prefix    # "wave-3" → "3"
4. title  = wave.title (lowercased first letter unless proper noun)
5. subject = f"{type}({scope}): wave-{n} — {title}"
6. if len(subject) > 72:
       title = truncate(title, 72 - len(prefix))   # never truncate the prefix
       subject = f"{type}({scope}): wave-{n} — {title}"
```

The planner is responsible for setting `wave.commit_type` per the type enum in SKILL.md. `wave-commit.sh` does not infer it.

## Idempotency contract recap

The full check is in SKILL.md → "Idempotency checks". Key invariants for implementers:

- `wave-commit.sh` checks the last 50 commits' subjects for an exact match; if found, exits 0.
- The exact-match comparison uses `grep -Fxq` (fixed-string, full-line, quiet) to avoid regex pitfalls with `(`, `)`, and the em-dash.
- Re-runs after a crash never produce a duplicate commit. They never `--amend`. They simply no-op.

## Out-of-scope clarifications

- This skill does NOT define when to bump versions; that is project-specific and lives in release-management tooling, not in conventional-commit shape.
- This skill does NOT define `feat!:` shorthand for breaking changes. Use the `BREAKING CHANGE:` trailer exclusively to keep parsing trivial for the report builder.
- This skill does NOT prescribe a body for every commit. Bodies are optional; trailers are not.
