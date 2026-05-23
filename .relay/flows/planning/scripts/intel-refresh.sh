#!/usr/bin/env bash
# intel-refresh.sh — invoke the intel-refresh Relay flow inline.
#
# Inputs:  none.
# Outputs: rewrites .planning/intel/* and docs/INTEL.md as needed.
# Exit:    0 if intel updated (or already up-to-date), 1 if nothing changed.
#
# Used as a `step.script` at the head of the planning flow (and as an
# optional standalone refresh). Idempotent — a clean working tree against
# the snapshot is a no-op exit 1.

SCRIPT_NAME="intel-refresh"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd relay

# If the snapshot is missing, force a full rebuild via --full=true.
snapshot=".planning/intel/.snapshot"
input_args=()
if [ ! -f "$snapshot" ]; then
  log "no .snapshot — running full intel rebuild"
  input_args+=("--input" '{"full":true}')
fi

# Run the intel-refresh flow. The flow's `patch` step writes
# `noop: true` into its handoff when nothing changed — we surface that as
# exit 1 so callers (e.g. planning) can decide whether to skip downstream
# work.
log "invoking relay run intel-refresh"
# `--no-worktree` is load-bearing: intel-refresh writes to
# .planning/intel/* and docs/INTEL.md, and subsequent planning steps
# read those files in-place. If relay created an isolated worktree for
# this nested run, the writes would land in a temp dir invisible to the
# outer planning flow. Equally important: the fresh worktree would be a
# `git worktree add HEAD` checkout, which excludes gitignored files —
# the intel-refresh flow's own `dist/flow.js` (built artifact, in
# .gitignore) wouldn't exist there, and relay would error with "Flow
# module not found — build has not been run". Sharing the outer
# worktree's cwd gives both visibility and access to the built flow.
#
# `"${input_args[@]+"${input_args[@]}"}"` is the bash 3.2-safe form: it
# expands to nothing when the array is empty, sidestepping `set -u` which
# would otherwise abort the script on macOS bash 3.2.
run_dir=$(relay run intel-refresh --no-worktree "${input_args[@]+"${input_args[@]}"}" --print-run-dir 2>/dev/null \
  || relay run intel-refresh --no-worktree "${input_args[@]+"${input_args[@]}"}" >&2 && true)

# Locate the latest run dir if the CLI didn't print one.
if [ -z "${run_dir:-}" ] || [ ! -d "$run_dir" ]; then
  run_dir=$(ls -1dt .relay/runs/*/ 2>/dev/null | head -n1 | sed 's:/$::')
fi

patched_handoff="${run_dir}/handoffs/patched.json"
if [ -f "$patched_handoff" ]; then
  if jq -e '.noop == true' "$patched_handoff" >/dev/null 2>&1; then
    log "intel snapshot already up-to-date — no patches written"
    exit 1
  fi
fi

log "intel refreshed"
exit 0
