# Bug: prompt steps run inside the per-run worktree, script + branch steps do not

**Affected versions:** `@ganderbite/relay-core@0.7.0`, `0.7.1`, `0.7.2`. CLI `@ganderbite/relay@0.7.3`.
**Severity:** High. Silently breaks every flow that mixes prompt steps (which write files via the `Write` tool) with script steps (which then read those files). The two kinds of steps see different working directories within a single run, so prompt-step file writes are invisible to downstream script-step checks. Failures look like LLM hallucination but are actually filesystem isolation.
**Design intent (per the docs):** one worktree per run. **Observed behavior:** the worktree is effectively per-step — every step kind picks its own cwd, and only prompt steps land in the worktree.

## Summary

`relay-core` 0.7.x runs each invocation in a per-run git worktree at `$TMPDIR/relay-worktrees/<runId>/` (see `orchestrator/worktree-setup.ts`). The intent — confirmed by the docstring in `orchestrator/run-options.ts` — is that **the entire run** operates inside that worktree, so file edits from step N are visible to step N+1 within the same run.

The actual implementation honors that contract for **prompt** steps only. **Script** and **branch** steps ignore the worktree cwd entirely. Within a single run:

| Step kind | cwd source | Lands in… |
| --- | --- | --- |
| `step.prompt` | `ctx.cwd` (the worktree path set by `setupWorktree`) | the worktree |
| `step.script` | `step.cwd ?? runDir` — `ctx.cwd` is **never consulted** | the user's `step.cwd` path (resolved against the parent process cwd, i.e. the project root) or the run directory |
| `step.branch` | same as script | same as script |

Consequence: a prompt step that writes `docs/INTEL.md` writes to `$TMPDIR/relay-worktrees/<runId>/docs/INTEL.md`. The next-step `step.script({ cwd: '.' })` runs in the user's project tree and sees no file. From the user's POV the prompt step "successfully" produced nothing.

## Where the bug lives

`packages/core/src/orchestrator/exec/prompt.ts` — correct:

```ts
// line ~4077 in the bundled dist; pseudo-line in source
const invocationCtx = {
  flowName: ctx.flowName,
  runId: ctx.runId,
  // ...
  ...(ctx.cwd !== undefined ? { cwd: ctx.cwd } : {}),
};
```

`packages/core/src/orchestrator/exec/script.ts` — **the bug**:

```ts
const cwd = step.cwd ?? runDir;
//          ^^^^^^^^^^^^^^^^^^
//          ctx.cwd is never read — the worktree path the orchestrator
//          computed for this run is silently dropped.
```

`packages/core/src/orchestrator/exec/branch.ts` has the identical line.

The prompt-step invocation path correctly threads `ctx.cwd` (which `setupWorktree` populates with the worktree path). The script/branch paths short-circuit that.

## Reproducer

A minimal two-step flow that demonstrates the cross-step file visibility break:

```ts
// .relay/flows/repro/flow.ts
import { defineFlow, step, z } from '@ganderbite/relay-core';

export default defineFlow({
  name: 'repro',
  version: '0.1.0',
  description: 'Repro: script steps do not see prompt-step file writes within the same run',
  input: z.object({}),
  start: 'write-doc',
  steps: {
    'write-doc': step.prompt({
      promptFile: 'prompts/write-doc.md',
      tools: ['Read', 'Write'],
      output: {
        handoff: 'doc',
        schema: z.object({ doc_path: z.string() }),
      },
    }),
    'check-doc': step.script({
      run: ['bash', '-c', 'pwd; ls -la docs/REPRO.md 2>&1 || { echo "MISSING from $(pwd)"; exit 1; }'],
      cwd: '.',
      dependsOn: ['write-doc'],
      onFail: 'abort',
    }),
  },
});
```

`prompts/write-doc.md`:

```markdown
Use the Write tool to create `docs/REPRO.md` with at least 200 bytes of arbitrary content.
Then submit a handoff with: { "doc_path": "docs/REPRO.md" }
```

```bash
mkdir -p docs && git init -q
relay run .relay/flows/repro
```

## Expected behavior

Within a single run, all steps share one worktree. `write-doc` writes `docs/REPRO.md` inside the worktree; `check-doc` runs in the same worktree and finds the file. The `pwd` printed by `check-doc` is the worktree path (`/.../relay-worktrees/<runId>`), the same path the prompt step's claude-cli subprocess used.

## Actual behavior

`write-doc` lands `docs/REPRO.md` inside `$TMPDIR/relay-worktrees/<runId>/docs/REPRO.md`.

`check-doc` prints `pwd` = the user's project root (where `relay run` was launched), not the worktree. The `ls` fails: `MISSING from /Users/.../project-root`. The file IS there — just in the worktree, not the project root.

`--no-worktree` works around the issue: both step kinds run in the project root, see the same files, run passes. But that disables isolation, which is not the user's intent — they want isolation, with a single cwd shared across step kinds for the duration of one run.

## Real-world impact

Observed in `sdlc-init` (a bootstrap flow that writes `docs/INTEL.md`, `docs/ARCHITECTURE.md`, etc. then runs `verify-*` script-step gates on each file). Every `verify-*` gate fails because the prompt wrote to the worktree and the script reads from the project root. Cost: ~$1.42 of Opus tokens wasted in one run before the abort cascade; multiple hours of human debugging time blaming the LLM for not calling `Write`.

The same bug surfaced earlier as "wave-runner hallucination" in `sprint-implementation`. The worktree for that run (`$TMPDIR/relay-worktrees/45ae1f/`) is still on disk and contains the full sprint output — `apps/`, `packages/`, `.planning/`, etc. — none of which ever reached the user's project tree because the inline `wave-commit` shell ran outside the worktree and saw no diff to commit. The work was real; the cross-step cwd mismatch hid it.

## Fix

One-line change in two files; the orchestrator already computes the right cwd and threads it via `ctx`.

`packages/core/src/orchestrator/exec/script.ts`:

```diff
-  const cwd = step.cwd ?? runDir;
+  const cwd = step.cwd ?? ctx.cwd ?? runDir;
```

`packages/core/src/orchestrator/exec/branch.ts`: identical change.

This preserves the existing behavior when `step.cwd` is explicitly set (a step can still override), preserves the legacy fallback to `runDir` when neither is set, and adds the missing middle case: honor the worktree cwd the orchestrator already established for the run.

After this fix, every step kind in a single run shares the same working directory — matching the docstring's stated intent.

### Tests to add

`packages/core/tests/orchestrator/exec/script.test.ts` should cover:

1. `ctx.cwd` set, `step.cwd` unset → spawn cwd is `ctx.cwd`. Currently fails.
2. `ctx.cwd` unset, `step.cwd` set → spawn cwd is `step.cwd`. Currently passes.
3. Both set → `step.cwd` wins. (Explicit step config beats run-level default.)
4. Both unset → `runDir`. (Existing fallback.)

Mirror in `branch.test.ts`.

A higher-level integration test would be a two-step flow `(prompt writes file) → (script reads same file)` running under `setupWorktree` → assert exit 0. That test would have caught this regression.

## Workaround for users on 0.7.x

Pass `--no-worktree` to `relay run`. This disables the worktree entirely, which sidesteps the cross-cwd inconsistency at the cost of losing isolation. For flows whose purpose is to mutate the project tree (anything that writes `docs/`, `.planning/`, scaffolding, configs, schemas), this is fine and arguably desired — the isolation provided no value when the next step couldn't see the writes anyway.

## Recovery for past runs

The worktrees on disk still hold the work from prior runs that "succeeded" but left no project-tree changes. Salvageable:

```bash
# macOS
ls /private/var/folders/*/T/relay-worktrees 2>/dev/null
# Linux
ls /tmp/relay-worktrees 2>/dev/null

# Inspect a specific run's worktree
ls -la /path/to/relay-worktrees/<runId>/

# Recover files (e.g. for sprint-implementation run 45ae1f)
cp -r /path/to/relay-worktrees/<runId>/apps ./
cp -r /path/to/relay-worktrees/<runId>/packages ./
cp -r /path/to/relay-worktrees/<runId>/.planning ./
```

## Suggested complementary improvements (out of scope for the one-liner)

1. **Loud breadcrumb at run start when worktree is active.** A single stderr line naming the worktree path. Even with the cwd fix landed, users benefit from knowing the run is operating on an isolated checkout — for `git push`, `gh pr create`, and similar steps that interact with remotes.
2. **Sync-back option.** Some flows (sdlc-init) want their writes to land in the user's project tree at run end. A `worktree: 'commit-and-merge'` mode that commits the worktree's changes to a branch and merges into the launch branch on success would close the loop. Optional, off by default.

## Environment

- `@ganderbite/relay-core`: 0.7.2
- `@ganderbite/relay` (CLI): 0.7.3
- Node: 25.8.0
- claude-cli: 2.1.140
- OS: macOS (Darwin 25.3.0)
- git: 2.x (system)
