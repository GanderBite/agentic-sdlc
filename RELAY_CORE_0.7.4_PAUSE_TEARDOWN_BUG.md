# Bug: per-run git worktree is torn down at `step.ask` pause, discarding all in-progress files before resume

**Affected versions:** `@ganderbite/relay-core@0.7.4`. CLI `@ganderbite/relay@0.7.5`.
**Severity:** High. Silently discards every file that prompt steps wrote to the worktree if a `step.ask` pauses the run. On resume, a fresh worktree is created from HEAD, which does not contain the discarded files. Downstream prompt steps that read those files for context (`Read docs/INTEL.md`, etc.) either fail or hallucinate.
**Related:** Third in a sequence of worktree-lifecycle defects, after `RELAY_CORE_0.7.2_WORKTREE_BUG.md` (script/branch executors ignored `ctx.cwd`, fixed in 0.7.3) and `RELAY_CORE_0.7.3_RESUME_CWD_BUG.md` (ctx.cwd reset to worktree-root on resume, fixed in 0.7.4 via commit `668173f`). The current bug is in the same module (`worktree-setup.ts` / `execute-run.ts`) and surfaces only after the previous two are fixed enough that pause/resume sometimes works.

## Summary

`execute-run.ts:173` unconditionally tears down the per-run worktree in a `finally` block:

```ts
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  await closeProviders(uniqueProviders, logger);
  await teardownWorktree(worktreePath, gitRoot, logger);   // ← always runs
}

// Paused runs already had their run-level status flipped to 'paused' by
// pauseStep inside the walker; re-applying markRun here would either be
// a no-op or, worse, sweep the in-flight ask step into 'failed'. Skip
// the markRun pass and persist whatever the pause path already wrote.
if (runStatus !== 'paused') {
  // ...
}
```

The `if (runStatus !== 'paused')` branch immediately below the finally is explicit evidence that pause is a normal exit path. But the teardown above doesn't honor that distinction — the worktree is removed on pause just as it is on success or failure.

Consequences when a flow includes both prompt steps that write files (via the `Write` tool) AND a `step.ask` somewhere downstream:

1. Pre-pause prompt steps write `docs/INTEL.md`, `docs/APPLICATION_BRIEF.md`, etc. into the worktree.
2. The flow reaches a `step.ask`. Relay flips `runStatus = 'paused'` and returns from the dispatcher.
3. The `finally` block runs. `teardownWorktree` removes the worktree and its `git worktree remove` cleans up the git metadata.
4. The user submits their ask answers (`relay answer <runId>`) and triggers resume.
5. `executeRun` is called again. `setupWorktree` creates a fresh worktree from HEAD.
6. The new worktree contains everything in HEAD — but the pre-pause prompt writes were never committed, so they're absent.
7. The next prompt step (e.g. `tech-stack` after `approve-arch`) reads `docs/ARCHITECTURE.md` for context. The file isn't there. The LLM either fails the Read or fabricates the architecture.

## Reproducer

```ts
// .relay/flows/repro/flow.ts
import { defineFlow, step, z } from '@ganderbite/relay-core';

export default defineFlow({
  name: 'repro',
  version: '0.1.0',
  description: 'Repro: pause teardown discards worktree files',
  input: z.object({}),
  start: 'write-then-pause',
  steps: {
    'write-then-pause': step.prompt({
      promptFile: 'prompts/write.md',
      tools: ['Write'],
      output: {
        handoff: 'doc',
        schema: z.object({ doc_path: z.string() }),
      },
    }),

    'ask': step.ask({
      dependsOn: ['write-then-pause'],
      questions: [
        { id: 'continue', kind: 'confirm', label: 'Continue?', default: true },
      ],
    }),

    'verify-after-resume': step.script({
      run: ['bash', '-c', 'pwd; ls -la docs/REPRO.md || { echo MISSING; exit 1; }'],
      dependsOn: ['ask'],
      onFail: 'abort',
    }),
  },
});
```

`prompts/write.md`:

```markdown
Use the Write tool to create `docs/REPRO.md` with at least 100 bytes of content.
After writing, return: { "doc_path": "docs/REPRO.md" }
```

Reproduce:

```bash
mkdir -p docs && git init -q && git add -A && git commit -q -m init
relay run /path/to/.relay/flows/repro
# the prompt step writes docs/REPRO.md into the worktree
# the ask step pauses for input
# === at this point, observe: ===
ls /private/var/folders/*/T/relay-worktrees/<runId>     # macOS — gone
git worktree list                                        # no <runId> entry

# answer and resume
relay answer <runId> continue=true
# verify-after-resume: pwd is a new worktree, MISSING is printed, run aborts
```

## Expected behavior

The worktree is preserved across `step.ask` pauses. Its lifecycle is "one per run", not "one per invocation". Resume re-uses the existing worktree (via `git worktree list` / probe) rather than creating a new one from HEAD.

## Actual behavior

`teardownWorktree` fires unconditionally in the `finally`. The worktree is gone before the function returns. Resume creates a fresh worktree from HEAD; pre-pause file work is lost.

## Where the bug lives

`packages/core/src/orchestrator/execute-run.ts`, in the `finally` block of `executeRun`:

```ts
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  await closeProviders(uniqueProviders, logger);
  await teardownWorktree(worktreePath, gitRoot, logger);
}
```

`runStatus` is in scope but not consulted. The author was aware of pause as a status (the next `if (runStatus !== 'paused')` block confirms it), but the teardown path missed the same gating.

## Suggested fix

Skip teardown when the run paused:

```ts
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  await closeProviders(uniqueProviders, logger);
  if (runStatus !== 'paused') {
    await teardownWorktree(worktreePath, gitRoot, logger);
  }
}
```

This leaves the worktree on disk between pause and resume. The resume path should then probe for an existing worktree before creating one:

```ts
// in setupWorktree, before the createWorktree call:
const worktreePath = join(tmpdir(), WORKTREES_SUBDIR, opts.runId);
try {
  await access(worktreePath);
  // Existing worktree from a paused run; reuse it.
  return ok(worktreePath);
} catch {
  // Fresh run; create.
}
```

(Or use `git worktree list --porcelain` and parse for the matching path — more git-native than `access`.)

Two failure modes to test:
1. User aborts a paused run (Ctrl+C the resume, or `relay abort`). The worktree must still be torn down at that point.
2. User modifies the launch repo between pause and resume (e.g. switches branches, makes commits, rebases). Reusing the worktree is correct — its HEAD is frozen at the moment of pause, which is what the run was already working against.

A separate concern: stale worktrees from runs that were killed mid-flight (SIGKILL, OS reboot) should be reaped on next launch via `git worktree prune` or an explicit `relay sweep` subcommand. Currently `/private/var/folders/*/T/relay-worktrees/` accumulates orphans (we have one at `45ae1f` from an earlier run that was force-killed — still listed by `git worktree list` after weeks).

### Test that would have caught this

```ts
// tests/orchestrator/pause-preserves-worktree.test.ts
it('preserves the worktree across step.ask pause', async () => {
  const flow = defineFlow({
    name: 'pause-test',
    version: '0.1.0',
    description: '',
    input: z.object({}),
    start: 'write',
    steps: {
      write: step.prompt({
        promptFile: 'write.md',
        tools: ['Write'],
        output: { handoff: 'd', schema: z.object({ path: z.string() }) },
      }),
      ask: step.ask({ dependsOn: ['write'], questions: [{ id: 'ok', kind: 'confirm', label: '?', default: true }] }),
    },
  });
  const { runId } = await runUntilPaused(flow);
  const wtPath = join(tmpdir(), 'relay-worktrees', runId);
  expect(await pathExists(wtPath)).toBe(true);        // <-- currently fails
  expect(await pathExists(join(wtPath, 'foo.md'))).toBe(true);
});
```

## Real-world impact

Observed in `sdlc-init` run `5eed58`. The flow's shape is:

```
intel → verify-intel → brief-questions → ask-brief → brainstorm →
verify-brainstorm → architecture → verify-architecture → approve-arch → tech-stack → …
```

The run reached `approve-arch` and paused, after successfully passing `verify-architecture`. At pause, the worktree contained:

- `docs/INTEL.md`
- `docs/APPLICATION_BRIEF.md`
- `docs/ARCHITECTURE.md`
- 7 files under `.planning/intel/`

All three verify-* gates passed before the pause, so we have evidence those files existed at the moment of pause. After the pause, the worktree was gone. Token spend on the pre-pause steps that are now orphaned (their output discarded): ~$2-3 of Opus.

The user's resume options at this point are:
1. Resume anyway — downstream prompt steps will Read files that don't exist, either failing or hallucinating.
2. Abort the run and restart with `--no-worktree` (the workaround).
3. Manually `cp` the missing files into the launch project from somewhere — but they're truly gone from disk, so this isn't an option.

There's no recovery path that salvages the discarded work; the user has to re-spend the tokens.

## Workaround

`relay run --no-worktree …`. With isolation disabled, prompt-step file writes land in the launch project directly and survive pauses. For flows whose explicit purpose is to mutate the project tree (`sdlc-init`, `discovery`), this is arguably the correct posture anyway — isolation provides no value to bootstrap flows whose entire output is project mutation.

For flows where you genuinely want isolation (analysis flows, multi-experiment fan-outs), don't include a `step.ask` until this is fixed, or accept that any human pause discards work.

## Environment

- `@ganderbite/relay-core`: 0.7.4
- `@ganderbite/relay` (CLI): 0.7.5
- Node: 25.8.0
- claude-cli: 2.1.141
- OS: macOS (Darwin 25.3.0)
- git: 2.x (system)

## Open question

A defensible alternative design: **always tear down on pause**, but treat the pause→resume cycle as a single logical run that COMMITS the pre-pause work into the worktree's branch before tear-down, so the resume worktree (created from that same branch's tip) contains everything. This is more complex but avoids the "worktree lives in `$TMPDIR` for arbitrarily long" failure mode where macOS's tmp-reaper or a reboot wipes the worktree out from under a paused run.

The two strategies trade different reliability properties:

| Strategy | Win | Lose |
|---|---|---|
| Keep worktree alive across pause | Simple. Works for arbitrary file mutations. | Worktree lives in `$TMPDIR` arbitrarily long; vulnerable to OS cleanup, reboots, manual `rm -rf /tmp`. |
| Commit-and-recreate | Run survives reboots, OS tmp-reaping, etc. | Requires a clean `git add -A && git commit` strategy; conflicts with the launch user's git state if they're not careful; commits accumulate in the worktree's branch. |

Either works; current behavior (tear down at pause without commit) is the worst of both.
