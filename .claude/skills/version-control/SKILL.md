<!-- version: 1.0.0 -->

# version-control

## Purpose

Branching, conventional commits, PR composition, rebase/conflict policy, and idempotency rules for the agentic SDLC. Encodes WHAT agents do to the working tree and WHAT they never do — `git commit` is performed exclusively by `scripts/wave-commit.sh`, never by an agent.

## Consumers

- `task-builder` (always-on). Prepares the working tree inside a single task. Knows which files are off-limits and that it MUST NOT run `git commit`, `git push`, or `git rebase` itself.
- `wave-reviewer` (always-on). Reads `task.target_files` against the actual diff; consults this skill for `may_also_touch` disjointness exclusion and frozen contract files.
- `wave-runner` (always-on). Orchestrates a wave but NEVER edits code and NEVER commits. Reads this skill for branch naming, rollback semantics, the never-amend rule, and the idempotency contract with `wave-commit.sh`.

## Rules

Numbered, imperative, verifiable. Aligned with §9, §9.4, §12, §12.1, §13, §14.1, §14.2 of `docs/AGENTIC_SDLC.md`. The full forbidden-action list is in **Forbidden actions** below.

1. Agents NEVER run `git commit`. `scripts/wave-commit.sh` is the only committer during a sprint; `scripts/commit-sdlc-init.sh` is the only committer during `sdlc-init`.
2. Agents NEVER run `git push`, `git merge`, `git rebase`, `git reset --hard`, `git branch -D`, or `git checkout --` against tracked files.
3. Agents NEVER amend; new commits only (§9 rollback, §12).
4. Agents NEVER bypass hooks or signing (`--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`).
5. Agents NEVER force-push. Fixups land as normal additional commits.
6. Branch deletion and merge to `main` require a human (§13).
7. Agents NEVER modify `.planning/sprints/*/contracts/` during a running sprint (§5.4 — frozen).
8. Agents NEVER edit `.planning/estimation_priors.json` directly. Retros emit `priors-patch.json`; `scripts/merge-priors.mjs` folds patches in (§11.2).
9. Agents NEVER hand-resolve conflicts in `INTEL.md` or `.planning/intel/`. The `post-merge` hook reruns `relay run intel-refresh` (§12.1).
10. Wave-runner MUST be idempotent: re-entering after a crash produces the same final state given the same task outcomes. Always re-read `.planning/state/<sprint_id>.json` at entry.
11. Wave-commit MUST be idempotent: if the wave's commit already exists at or below `HEAD`, exit 0 without producing a second commit (§9.4).
12. PR creation MUST be idempotent: `gh pr create --draft || gh pr edit` (§9.4).
13. Sprint IDs MUST be reserved atomically via `scripts/reserve-sprint-id.sh` BEFORE planning (§12.1).
14. The PR opens once, at the END of the sprint — never incrementally (§12).
15. The PR opens EVEN WHEN BLOCKED. `open-pr.sh` adds the `BLOCKED` label and a pinned comment listing blocked tasks (§9.2).
16. Skill additions land on `skills/<topic>` branches, separate from feature work, to keep `INDEX.json` out of feature PRs (§6.5, §12.1).
17. Rebase conflicts against `main` follow **Rebase / conflict policy**: trivial cases may be auto-resolved; everything else MUST escalate via `step.ask`.

## Branch naming

Exact formats. Placeholders in `<...>`. Never deviate.

| Branch kind | Format | Created by |
|---|---|---|
| sdlc-init | `sdlc/init` | `scripts/commit-sdlc-init.sh` (single PR) |
| sprint feature | `sprint/<sprint_id>-<slug>` | `scripts/sprint-branch.sh` |
| skill addition | `skills/<topic>` | human or `skill-author` flow |

- `<sprint_id>` — zero-padded numeric ID reserved on `main` via `scripts/reserve-sprint-id.sh` (e.g. `001`, `042`).
- `<slug>` — lowercase, hyphenated, ≤40 chars, derived from sprint title.
- `<topic>` — dominant skill name being added (e.g. `playwright`).

Examples: `sdlc/init`, `sprint/001-resource-soft-delete`, `skills/playwright`.

## Commit format

One atomic conventional commit per wave. Produced by `scripts/wave-commit.sh`. Subject line:

```
<type>(<scope>): wave-<n> — <wave title>
```

Hard rules on the subject:

- Subject ≤72 characters total. If the wave title would push it over, truncate the title (not the prefix).
- Imperative mood verbs in the wave title: `add`, `update`, `fix`, `remove`, `refactor`, `rename`, `extract`, `inline`, `move`. Never `added`, `adds`, `adding`.
- No trailing period on the subject line.
- The em-dash separator is U+2014 (`—`), not a hyphen.
- Lowercase the type and scope.

### Type — exhaustive enum

Exactly one. If none fits, the wave is mis-categorized.

| Type | When |
|---|---|
| `feat` | net-new user-visible behavior or API surface |
| `fix` | bug fix that does not change API |
| `test` | new tests only, no production-code change |
| `refactor` | internal restructure, behavior unchanged |
| `chore` | tooling, deps, repo hygiene |
| `docs` | documentation only |
| `ci` | CI config / workflow files |
| `build` | build system, bundler, compiler config |
| `perf` | performance change, behavior preserved |
| `revert` | reverts a prior commit; trailer `Reverts: <sha>` required |
| `style` | whitespace, formatter output; no logic change |

### Scope rules

Single token, lowercase, hyphenated.

- Every task in the wave is module-local AND shares one module per `.planning/intel/modules.json` → scope = that module's `name` (e.g. `resource`, `auth`).
- Otherwise → scope = `repo`.

Never a path, file extension, or comma-separated list.

### Body (optional)

When present, one bullet per task:

```
- task-7f2a: Add soft-delete column to Resource model
- task-9c1b: Filter deletedAt in list query
```

### Trailers

Blank line above the trailer block; case-sensitive keys; one trailer per line.

| Trailer | Required when |
|---|---|
| `BREAKING CHANGE: <description>` | wave introduces a breaking API change |
| `Refs: <FEATURE-id>` | originating brief has an identifier (e.g. `Refs: FEATURE-resource-deletion`) |
| `Reverts: <sha>` | type is `revert` |
| `Co-Authored-By: <Name> <email>` | always (one line per co-author) |

Full template, worked examples, scope-decision tree, and the deterministic subject-generation algorithm live in [`references/commit-template.md`](references/commit-template.md).

## PR composition

The PR is opened once, at the END of the sprint, by `scripts/open-pr.sh` (body composed by `scripts/build-report.sh`). Body sections, in order:

1. **Sprint summary** — sprint id, title, branch, total commits, `Refs: FEATURE-…` if applicable.
2. **Per-wave summary table** — columns: wave id, title, verdict (`pass`/`blocked`/`failed`), tasks done, tokens used, commit sha.
3. **Verification report** — relative-path link to each `review-<wave>.json`.
4. **Non-blocking findings** — `high` + `medium` findings from `findings-<wave>.json` as bullets; `low` and `info` summarised by count only.
5. **Open issues / blocked tasks** — link to each `.planning/blocked/<sprint_id>/<task_id>.md`. Section omitted if empty.
6. **Retro link** — relative link to `.planning/retros/sprint-<id>.md`.

When any task is blocked, `open-pr.sh` adds the `BLOCKED` label and pins a comment listing all blocked tasks.

## Rebase / conflict policy

When `git rebase main` reports conflicts on a sprint branch, classify each before acting.

### Auto-resolvable (trivial) — agent MAY resolve when ANY hold

- **Non-overlapping line ranges**: incoming and local hunks touch disjoint line ranges within the same file. Detect via `git merge-file --diff3` showing zero overlapping change-bars.
- **Lockfile**: conflict is in a deterministically regenerated lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, `Pipfile.lock`, `poetry.lock`). Resolution: delete the lockfile, re-run the package manager's install command from `build-graph.json → tools.package_manager`, stage the regenerated file.
- **Whitespace-only / import-order-only**: `git diff -w` after a candidate resolution shows zero diff.

### Non-trivial — agent MUST escalate via `step.ask`

Every other conflict: overlapping line ranges, semantic conflicts, conflicts inside `.planning/sprints/*/contracts/`, conflicts that mutate the same symbol. Attach the conflict snippet. Do NOT guess.

### Files conflicts NEVER touch

- `.planning/sprints/*/contracts/` — frozen; abort sprint.
- `.planning/estimation_priors.json` — patch model; `scripts/merge-priors.mjs` resolves on `main` after merge.
- `INTEL.md`, `.planning/intel/*` — `post-merge` hook reruns `relay run intel-refresh`; agents do nothing.

## Idempotency checks

CHECK-BEFORE-ACT. Run the check; act only on the documented exit code.

### `wave-commit.sh` — before committing

```bash
# 1. Wave commit already at or below HEAD?
expected="${COMMIT_TYPE}(${SCOPE}): wave-${WAVE_ID#wave-} — ${WAVE_TITLE}"
git log --format='%s' -n 50 | grep -Fxq -- "$expected" && { echo "already committed" >&2; exit 0; }

# 2. Anything to commit?
git diff --cached --quiet && git diff --quiet && { echo "nothing to commit" >&2; exit 1; }
# exit 1 per scripts contract (§20): 1 = nothing to commit (idempotent OK)
```

### Builder — before creating a `target_files.create` path

```bash
if [ -f "$target" ] && [ -n "$EXPECTED_SHA256" ]; then
  actual=$(shasum -a 256 "$target" | awk '{print $1}')
  [ "$actual" = "$EXPECTED_SHA256" ] && exit 0
fi
```

If no hash is pinned, skip creation when the file exists AND contains every symbol asserted by the task's `verification.custom` `rg` checks.

### `open-pr.sh` — upsert, never error on re-run

```bash
existing=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')
if [ -n "$existing" ]; then
  gh pr edit "$existing" --body-file "$body" --title "$title"
else
  gh pr create --draft --head "$branch" --base main --title "$title" --body-file "$body"
fi
```

Shorthand `gh pr create --draft || gh pr edit` (§9.4) is acceptable for simple bodies.

### Wave-runner — re-read state at every entry

```bash
state_path=".planning/state/${SPRINT_ID}.json"
test -f "$state_path" || { echo "state missing" >&2; exit 1; }
# Skip tasks marked done; reset in_progress to todo before fan-out.
```

### Atomic state writes (§22)

```bash
tmp=$(mktemp "${state_path}.XXXXXX")
jq '...mutation...' "$state_path" > "$tmp" && mv "$tmp" "$state_path"
```

## Forbidden actions

Hard list. An agent performing any of these is buggy; the wave MUST fail.

- `git commit` from any agent context (only `wave-commit.sh` / `commit-sdlc-init.sh` may commit).
- `git commit --amend` — never amend.
- `git push --force`, `git push -f`, `git push --force-with-lease`.
- `git push` to `main` or `master`.
- `git merge` into any branch.
- `git branch -D`, `git branch -d`, `git push <remote> --delete <branch>`.
- `git reset --hard`, `git reset --keep`, `git restore --staged` against tracked files (per-wave rollback is a human decision per §13).
- `git rebase --interactive`, `git rebase -i`.
- Flags `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`, `-c core.hooksPath=/dev/null`.
- `git config` mutating user or repo config.
- Any write under `.planning/sprints/*/contracts/` during a running sprint.
- Direct edit of `.planning/estimation_priors.json` (use `priors-patch.json` + `scripts/merge-priors.mjs`).
- Hand-editing `INTEL.md` or `.planning/intel/*` to resolve a merge conflict.

## Examples

### Correct subjects

```
feat(resource): wave-1 — add soft-delete column and service hooks
fix(auth): wave-3 — reject expired refresh tokens before lookup
test(repo): wave-2 — add integration tests for sprint-branch.sh
refactor(checkout): wave-4 — extract pricing into pure module
chore(repo): wave-1 — bump pnpm to 9.4.0 and regenerate lockfile
```

### Correct full message

```
feat(resource): wave-2 — wire soft-delete into list and detail queries

- task-7f2a: Filter deletedAt in resource.service.findAll
- task-9c1b: Filter deletedAt in resource.service.findOne
- task-3e8d: Add audit-log entry on soft-delete

Refs: FEATURE-resource-deletion
Co-Authored-By: Claude (wave-runner) <noreply@anthropic.com>
```

### Incorrect — rule violated

| Subject | Rule violated |
|---|---|
| `feat: wave-1 — add stuff` | scope rules: scope is required |
| `Feat(Resource): Wave-1 — Added soft-delete.` | lowercase type/scope; imperative mood (`Added`); no trailing period |
| `feat(resource, audit-log): wave-1 — …` | scope is a single token; for multi-module use `repo` |
| `feat(resource): wave-1 - add soft-delete` | em-dash must be U+2014, not ASCII hyphen |
| Any amended commit | rule 3: never amend |
