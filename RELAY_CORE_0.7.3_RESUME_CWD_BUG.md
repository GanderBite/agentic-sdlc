# Bug: `ctx.cwd` is reset to the worktree root (not the flow-dir subpath) when a run resumes after `step.ask`

**Affected versions:** `@ganderbite/relay-core@0.7.3`. CLI `@ganderbite/relay@0.7.4`.
**Severity:** High. Silently breaks every flow that mixes a `step.ask` pause with any downstream `step.script` that uses a flow-dir-relative `run` path. The pre-pause steps see `ctx.cwd = <worktree>/<flowDir>`; the post-resume steps see `ctx.cwd = <worktree>` (worktree root). Relative scripts that resolved fine before the pause fail with `spawn ENOENT` after it.
**Related:** This is a different defect from the script/branch cwd-inheritance issue fixed in 0.7.3. That earlier fix made `step.cwd ?? ctx.cwd ?? runDir` consistent across step kinds within one invocation. The bug here is that `ctx.cwd` itself takes a different value on the second invocation (the resume).

## Summary

For a flow with the shape:

```
prompt → script → ask → prompt → script
                  ─────── pause/resume here
```

the cwd seen by the first `script` step is the worktree's flow-dir subpath, while the cwd seen by the second `script` step is the worktree root. Identical `step.cwd` and `RunOptions` in both cases.

The symptom is mechanically observable in `~/.claude/projects/`: a run that ought to produce one session directory per prompt step (all at the same cwd) produces two distinct directories, one for the pre-pause cwd and one for the post-resume cwd. Example from a real run:

```
~/.claude/projects/-private-var-folders-pw-...-T-relay-worktrees-51b48c
~/.claude/projects/-private-var-folders-pw-...-T-relay-worktrees-51b48c--relay-flows-sdlc-init
```

claude-cli encodes its session storage path from the cwd it was launched with (slashes → dashes). The pre-pause sessions land in the second directory (the flow-dir); the post-resume session lands in the first directory (the worktree root). Same run, same worktree, two different cwds.

## Reproducer

```ts
// .relay/flows/repro/flow.ts
import { defineFlow, step, z } from '@ganderbite/relay-core';

export default defineFlow({
  name: 'repro',
  version: '0.1.0',
  description: 'Repro: ctx.cwd differs pre- and post-resume',
  input: z.object({}),
  start: 'pre-ask-script',
  steps: {
    // BEFORE the ask — runs with cwd=<worktree>/<flowDir>, finds the file.
    'pre-ask-script': step.script({
      run: ['bash', '-c', 'pwd; ls scripts/probe.sh'],
      onFail: 'abort',
    }),

    'one-question': step.prompt({
      promptFile: 'prompts/one-question.md',
      dependsOn: ['pre-ask-script'],
      tools: ['Read'],
      output: {
        handoff: 'q',
        schema: z.object({
          questions: z.array(z.object({
            id: z.string(), kind: z.literal('confirm'),
            label: z.string(), default: z.boolean(),
          })),
        }),
      },
    }),

    'ask': step.ask({ dependsOn: ['one-question'], questions: { from: 'q' } }),

    // AFTER the ask — same `run` shape, but cwd is now <worktree>, not <worktree>/<flowDir>.
    'post-ask-script': step.script({
      run: ['bash', '-c', 'pwd; ls scripts/probe.sh'],
      dependsOn: ['ask'],
      onFail: 'abort',
    }),
  },
});
```

`prompts/one-question.md`:

```markdown
Emit exactly one confirm question:
{ "questions": [{ "id": "ok", "kind": "confirm", "label": "Resume?", "default": true }] }
```

`scripts/probe.sh`:

```bash
#!/usr/bin/env bash
echo "probe ok"
```

```bash
chmod +x .relay/flows/repro/scripts/probe.sh
mkdir -p /tmp/repro-launch && cd /tmp/repro-launch && git init -q
relay run /path/to/.relay/flows/repro
# Answer the prompt, then relay resume <runId>
```

Run with `--verbose` and observe the two `pwd` outputs:

| step | observed `pwd` |
|---|---|
| `pre-ask-script` | `/var/folders/.../T/relay-worktrees/<runId>/.relay/flows/repro` |
| `post-ask-script` | `/var/folders/.../T/relay-worktrees/<runId>` |

`scripts/probe.sh` resolution succeeds in the first case and fails (`ls: scripts/probe.sh: No such file or directory`) in the second. The script file exists in the worktree at `<wt>/.relay/flows/repro/scripts/probe.sh` either way.

## Expected behavior

`ctx.cwd` is constant across all step dispatches within one run, regardless of whether the dispatch happens in the initial invocation or in a `resume` invocation. The post-resume dispatch sees the same cwd the pre-pause dispatch saw — `<worktree>/<flowDir>` when isolation is active.

## Actual behavior

`ctx.cwd` is recomputed on resume, and the recomputation lands on the worktree root rather than the flow-dir subpath. Two failure modes have been observed in practice:

1. **Most common**: post-resume script steps fail with `spawn <relative-path> ENOENT` because their `run` (`scripts/X`, etc.) was authored against the flow-dir cwd.
2. **Silent corruption**: post-resume *prompt* steps run claude-cli from the worktree root rather than the flow-dir. The LLM can still complete the prompt (it doesn't depend on cwd for tool calls), but it produces a *different* claude-cli session directory, which fragments any tooling that aggregates per-flow session data.

## Where the bug likely lives

`packages/core/src/orchestrator/worktree-setup.ts`, in the existence-check fallback:

```ts
const rel = relative(gitRoot, probeDir);
const candidate =
  rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    ? join(worktreePath, rel)
    : worktreePath;

// Untracked flow directories won't exist inside the worktree — fall back to
// the worktree root so the subprocess cwd is always a real path.
let worktreeCwd: string;
try {
  await access(candidate);
  worktreeCwd = candidate;
} catch {
  worktreeCwd = worktreePath;
}

return { worktreePath, gitRoot, worktreeCwd };
```

This existence check is correct on the initial run (the flow dir was committed → access succeeds → `worktreeCwd = candidate`). On resume, the resolution differs. Three plausible reasons, any of which would produce the observed symptom:

1. **`process.cwd()` differs between initial run and resume**, changing `probeDir` (via `probeDir = isAbsolute(flowDir) ? flowDir : join(process.cwd(), flowDir)`). If the resume invocation's cwd is the project root and the initial run's cwd was the same project root, this shouldn't trigger — but a CLI quirk where `relay resume` is launched from a different working directory (e.g. inside a subshell, a hook, or a programmatic embed) would.

2. **The worktree from the initial run is torn down at pause, and the resume creates a NEW worktree** whose checkout hasn't fully populated the flow dir by the time `access()` runs. A filesystem race.

3. **`createWorktree` returns `err` on resume** (e.g. because the prior worktree path already exists, or the lockfile from the prior teardown is stale). With `worktree: 'auto'`, the failure is silently logged at debug level and `setupWorktree` returns `worktreeCwd: undefined`. The downstream dispatcher then passes `undefined` to executors. Script steps fall through to `runDir`; prompt steps inherit parent process cwd (the launch dir). NEITHER is the worktree root, though — so this hypothesis doesn't fit the observed symptom (worktree root). Including it for completeness.

The actual cause is likely (1) or (2). A `log.info` line emitting `worktreeCwd` at every `setupWorktree` call would let users see which branch fires on each invocation.

## Real-world impact

Observed in `sdlc-init` (a bootstrap flow with one `step.ask` for the brainstorm Q&A). Every prompt step before the ask ran in `<wt>/.relay/flows/sdlc-init`; the post-resume `brainstorm` prompt step and the follow-up `verify-brainstorm` script step ran in `<wt>`. `verify-brainstorm`'s `run: 'scripts/assert-handoff-files.sh'` was relative to the flow dir, so `<wt>/scripts/...` doesn't exist → `spawn ENOENT` → run aborts.

Cost so far in our project tracking this down: ~$2.5 of Opus tokens spent on the pre-ask steps that ran fine but couldn't be salvaged after the abort, plus several hours of debugging time tracking down why "the same flow that worked yesterday now fails."

## Suggested fix

The conservative fix is to make `setupWorktree` log its decision so users can see which cwd was chosen each time:

```ts
args.logger.info(
  { event: 'worktree.setup', worktreePath, worktreeCwd, gitRoot, runId: args.runId,
    candidate, candidateExists: worktreeCwd === candidate },
  'worktree setup complete',
);
```

The actual fix depends on which of (1)/(2)/(3) above is the cause. Most likely candidate: the resume code path should pass `flowDir` as an ABSOLUTE path (or pass the initial-run's resolved `probeDir`) so the `relative(gitRoot, probeDir)` computation is stable across invocations. That removes hypothesis (1) entirely.

A test that would have caught this: an integration test that runs a flow with `step.prompt → step.script → step.ask → step.script`, pauses at the ask, resumes via the public API, and asserts `pwd` output (or `stat`s a known file via the second script step) is the same as the first script step's. The harness already has the bits for this.

## Workaround

Until a fix lands, invoke scripts via the absolute path that `relay-core` exports as `$RELAY_FLOW_DIR`:

```ts
// flow.ts
'verify-X': step.script({
  run: ['bash', '-c', '"$RELAY_FLOW_DIR/scripts/verify-X.sh"'],
  // ...
}),
```

`$RELAY_FLOW_DIR` is exported by relay-core's script-step env (`orchestrator/exec/script.ts` and `branch.ts`) and DOES survive the resume — only `ctx.cwd` is affected. The bash wrapper resolves the env var at execution time, the script path becomes absolute, and `spawn` can't ENOENT regardless of which cwd is in effect.

This is what we shipped to unblock our project; works reliably across runs that include any number of `step.ask` pauses.

## Environment

- `@ganderbite/relay-core`: 0.7.3
- `@ganderbite/relay` (CLI): 0.7.4
- Node: 25.8.0
- claude-cli: 2.1.141
- OS: macOS (Darwin 25.3.0)
- git: 2.x (system)

## Acknowledgement

Both worktree-cwd bugs (the one 0.7.3 fixed and this one) come from the same general design tension: making script/branch steps share the worktree with prompt steps is the right call, but the worktree-cwd value itself has subtle invariants that aren't being preserved everywhere. Once a fix for either of (1)/(2) above lands, the workaround can be removed and `run: 'scripts/X'` is sufficient again.
