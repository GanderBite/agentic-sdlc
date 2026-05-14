#!/usr/bin/env bash
# write-sprint-files.sh — final step of the planning flow. Writes the
# canonical .planning/sprints/<id>.json (and sibling tasks/waves/coverage
# files) from the in-run handoffs, after the plan validator passes.
#
# Inputs:  handoffs at $RELAY_HANDOFFS_DIR/{tasks,waves,sprints,coverage_report}.json.
# Outputs: .planning/sprints/<id>.json + .planning/sprints/<id>.{tasks,waves}.json
#          + .planning/sprints/<id>.coverage.json
# Exit:    0=ok, 1=missing handoff, 2=plan invalid (validator vetoed).

SCRIPT_NAME="write-sprint-files"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq node

handoffs="${RELAY_HANDOFFS_DIR:-}"
[ -n "$handoffs" ] && [ -d "$handoffs" ] || die 1 "RELAY_HANDOFFS_DIR not set or missing"
if [ -n "${HANDOFFS_PREFIX:-}" ]; then
  handoffs="$handoffs/$HANDOFFS_PREFIX"
  [ -d "$handoffs" ] || die 1 "HANDOFFS_PREFIX dir missing: $handoffs"
fi

for h in tasks waves sprints coverage_report; do
  [ -f "$handoffs/$h.json" ] || die 1 "missing handoff: $h.json"
done

# Coverage gate — a `fail` verdict means the planner missed acceptance
# bullets. Refuse to write so the human surfaces the gap.
if ! jq -e '.verdict == "pass"' "$handoffs/coverage_report.json" >/dev/null; then
  log "coverage report verdict != pass — refusing to write sprint files"
  jq '.gaps' "$handoffs/coverage_report.json" >&2 || true
  exit 2
fi

# Stage candidate files in a tempdir so a validator failure leaves
# .planning/sprints/ untouched.
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

mkdir -p .planning/sprints

# Deduplicate task ids (compose-tasks may emit dupes on re-prompt).
jq -c '{ tasks: (.tasks | unique_by(.id)) }' "$handoffs/tasks.json" >"$staging/tasks.json"
cp "$handoffs/waves.json" "$staging/waves.json"
cp "$handoffs/sprints.json" "$staging/sprints.json"
cp "$handoffs/coverage_report.json" "$staging/coverage_report.json"

# Per-sprint validation: each sprint object becomes one
# .planning/sprints/<id>.json with embedded waves and tasks. We pass each
# materialised sprint file through validate-plan.mjs before adopting it.
sprint_count=$(jq '.sprints | length' "$staging/sprints.json")
log "composing $sprint_count sprint file(s)"

for i in $(seq 0 $((sprint_count - 1))); do
  sprint=$(jq -c ".sprints[$i]" "$staging/sprints.json")
  sprint_id=$(printf '%s' "$sprint" | jq -r '.id')
  [ -n "$sprint_id" ] && [ "$sprint_id" != "null" ] || die 1 "sprint[$i] missing id"

  wave_ids=$(printf '%s' "$sprint" | jq -c '.waves')
  waves=$(jq -c --argjson ids "$wave_ids" '
    { waves: [.waves[] | select(.id as $id | $ids | index($id))] }
  ' "$staging/waves.json")

  task_ids=$(printf '%s' "$waves" | jq -c '[.waves[].tasks[]] | unique')
  tasks=$(jq -c --argjson ids "$task_ids" '
    { tasks: [.tasks[] | select(.id as $id | $ids | index($id))] }
  ' "$staging/tasks.json")

  out_sprint="$staging/${sprint_id}.json"
  out_tasks="$staging/${sprint_id}.tasks.json"
  out_waves="$staging/${sprint_id}.waves.json"
  printf '%s\n' "$sprint" >"$out_sprint"
  printf '%s\n' "$tasks" >"$out_tasks"
  printf '%s\n' "$waves" >"$out_waves"

  # Validate the materialised plan files.
  if ! node "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/validate-plan.mjs" "$out_sprint" "$out_tasks" "$out_waves" >&2; then
    log "validate-plan rejected $sprint_id"
    exit 2
  fi
done

# All sprints validated — promote into .planning/sprints/.
for i in $(seq 0 $((sprint_count - 1))); do
  sprint_id=$(jq -r ".sprints[$i].id" "$staging/sprints.json")
  mv -f "$staging/${sprint_id}.json"      ".planning/sprints/${sprint_id}.json"
  mv -f "$staging/${sprint_id}.tasks.json" ".planning/sprints/${sprint_id}.tasks.json"
  mv -f "$staging/${sprint_id}.waves.json" ".planning/sprints/${sprint_id}.waves.json"
  log "wrote .planning/sprints/${sprint_id}.json (+ tasks, waves)"
done

# Coverage report is shared across the run, not per-sprint.
cp "$staging/coverage_report.json" ".planning/sprints/_last_coverage.json"
log "all sprint files written"
