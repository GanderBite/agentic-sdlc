#!/usr/bin/env bash
# intel-refresh.sh — pre-planning freshness check for intel artifacts.
#
# Inputs:  none.
# Outputs: a log line indicating whether intel is fresh or stale.
# Exit:    1 if intel is fresh (signals "no-op continue" to the planning
#            flow, matching the `onExit: { '1': 'continue' }` mapping in
#            planning/flow.ts).
#          0 if intel was stale and a refresh is recommended (also
#            continues — staleness is a warning, not a blocker; the user
#            can re-plan after running intel-refresh).
#          Never aborts — planning proceeds on whatever intel is present.
#
# Why this is NOT `relay run intel-refresh`:
#   Relay flows run in temp worktrees created via `git worktree add HEAD`.
#   These worktrees do not contain gitignored paths like `dist/` and
#   `node_modules/`, so a nested `relay run` cannot load any flow's
#   compiled `dist/flow.js`. Even loading the flow code from the main
#   repo via an absolute path doesn't work, because intel-refresh's own
#   `branch.sh` does `git checkout -B sdlc/intel-refresh`, which would
#   yank the planning worktree off the `sdlc/plan-<slug>` branch the
#   outer flow committed to. Nesting relay flows is structurally
#   incompatible with relay's worktree isolation.
#
#   The clean separation: intel-refresh is its own flow, invoked
#   manually (`relay run intel-refresh`) when the user wants a fresh
#   snapshot. The planning flow just checks freshness here and warns.

SCRIPT_NAME="intel-refresh"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

snapshot_file=".planning/intel/.snapshot"
head_sha="$(git rev-parse HEAD 2>/dev/null || echo "")"

if [ ! -f "$snapshot_file" ]; then
  log "no .planning/intel/.snapshot — intel has never been built"
  log "RECOMMEND: run \`relay run intel-refresh\` before planning to populate intel"
  log "continuing with empty intel; the planner will produce a thin plan"
  exit 0
fi

snapshot_sha="$(tr -d '[:space:]' <"$snapshot_file")"
if [ -z "$snapshot_sha" ]; then
  log ".snapshot exists but is empty — treating as missing"
  log "RECOMMEND: run \`relay run intel-refresh\` before planning"
  exit 0
fi

if [ "$snapshot_sha" = "$head_sha" ] || [ "$snapshot_sha" = "INIT" ]; then
  log "intel snapshot matches HEAD ($snapshot_sha) — fresh"
  exit 1
fi

# Compute how far ahead HEAD is from the snapshot, just for the warning.
ahead="?"
if git rev-parse --verify --quiet "$snapshot_sha" >/dev/null 2>&1; then
  ahead="$(git rev-list --count "${snapshot_sha}..HEAD" 2>/dev/null || echo "?")"
fi

log "intel is STALE — snapshot at $snapshot_sha, HEAD at $head_sha (${ahead} commit(s) ahead)"
log "RECOMMEND: \`relay run intel-refresh\` (separately) then re-run planning for accurate task verification commands"
log "continuing with stale intel; planning may emit gates that don't reflect recent code changes"
exit 0
