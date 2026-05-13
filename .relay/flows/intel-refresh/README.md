# intel-refresh

`●─▶●─▶●─▶●  intel-refresh`

## What it does

Cheap maintenance flow that runs the intel-keeper role only.

## Sample output

A successful diff-only run patches a small set of files and finishes in seconds:

```
●─▶●─▶●─▶●  intel-refresh
 ✓ diff      mode=diff   changed=3   intel_to_patch=2
 ✓ patch     updated=.planning/intel/modules.json, .planning/intel/.snapshot
done — snapshot abc123 → def456
```

A noop run (no changes since the last snapshot) writes nothing and exits clean.

## Install

```bash
relay install intel-refresh
``` Diffs the codebase against `.planning/intel/.snapshot` and patches only the intel files affected by what changed. A clean run skips the rebuild entirely — this is the single biggest cost saving in the SDLC pipeline (per AGENTIC_SDLC.md §4).

```
diff ─▶ patch
```

Triggered by:

- humans on demand (`relay run .`),
- `loop` (`/loop 30m relay run .`),
- a `post-merge` git hook on `main`,
- the `planning` flow's `intel-refresh` script step at the start of every plan run.

## Estimated cost and duration

- **Cost:** $0.05–$0.50 per run (Sonnet; close to free on a noop run; billed to your Pro/Max subscription).
- **Duration:** 1–10 minutes; noop runs finish in seconds.

## Run

```bash
# Diff-only refresh — the common case.
relay run .

# Full rebuild (use when .snapshot is missing or you suspect drift).
relay run . --full=true
```

## Configuration

| Field | Type | Default | Notes |
|---|---|---|---|
| `full` | `boolean` | `false` | Force a full rebuild instead of a diff-only refresh. |

## Outputs

- Patched files under `docs/INTEL.md` and `.planning/intel/*` (only the ones the diff affected).
- Updated `.planning/intel/.snapshot` with the new HEAD SHA.

## Customization

Fork the flow and adjust the diff routing rules in `prompts/01_diff.md` if your repository has non-standard locations for tests, schemas, or build manifests. Lower `maxIterations` is irrelevant here (the flow has no loop); raise the diff-step `timeoutMs` if your repo's `git diff` is slow on first run.

## License

MIT.
