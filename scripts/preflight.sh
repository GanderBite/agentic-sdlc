#!/usr/bin/env bash
# preflight.sh — first step of sprint-implementation per §9.3.
#
# Inputs:  $SPRINT_ID env.
# Outputs: log to stdout/stderr.
# Exit:    0=ok, 1=tool missing, 2=dirty git, 3=auth fail, 4=plan invalid.
#
# Cheap insurance — fail fast before any code is written.

SCRIPT_NAME="preflight"
# shellcheck source=_lib.sh
. "$(dirname "$0")/_lib.sh"

cd "$(project_root)"

require_cmd git jq node
require_env SPRINT_ID

log "1/5 git state"
if [ -n "$(git status --porcelain)" ]; then
  log "dirty working tree — commit or stash before sprint execution"
  git status --short >&2
  exit 2
fi

log "2/5 tools listed in build-graph.json are on PATH"
build_graph=".planning/intel/build-graph.json"
if [ -f "$build_graph" ]; then
  # Collect first-token of every command in global.{tests,lint,build,smoke}
  # plus per_module.<*>.{tests,lint,build}. Skip shell control words.
  cmds=$(jq -r '
    [
      (.global // {} | to_entries[] | .value[]?),
      (.per_module // {} | to_entries[] | .value | to_entries[] | .value[]?)
    ] | map(select(type == "string"))
      | map(split(" ")[0])
      | map(select(. != null and . != ""))
      | unique
      | .[]
  ' "$build_graph")
  missing=()
  while read -r tool; do
    [ -z "$tool" ] && continue
    case "$tool" in
      rg|node|bash|sh|true|false|echo|cat|cd) continue ;;  # built-ins always ok
    esac
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done <<<"$cmds"
  if [ "${#missing[@]}" -gt 0 ]; then
    log "missing tools: ${missing[*]}"
    exit 1
  fi
else
  log "no build-graph.json yet — skipping tool check"
fi

log "3/5 deps install (best-effort)"
if [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile --silent || { log "pnpm install failed"; exit 1; }
elif [ -f "package-lock.json" ] && command -v npm >/dev/null 2>&1; then
  npm ci --silent || { log "npm ci failed"; exit 1; }
elif [ -f "uv.lock" ] && command -v uv >/dev/null 2>&1; then
  uv sync --frozen >/dev/null || { log "uv sync failed"; exit 1; }
elif [ -f "poetry.lock" ] && command -v poetry >/dev/null 2>&1; then
  poetry install --no-interaction --no-ansi >/dev/null || { log "poetry install failed"; exit 1; }
elif [ -f "go.sum" ] && command -v go >/dev/null 2>&1; then
  go mod download || { log "go mod download failed"; exit 1; }
else
  log "no recognised lockfile — skipping deps install"
fi

log "4/5 gh auth"
if command -v gh >/dev/null 2>&1; then
  if ! gh auth status >/dev/null 2>&1; then
    log "gh not authenticated — run \`gh auth login\`"
    exit 3
  fi
else
  log "gh not installed — open-pr.sh will fail; abort here to surface the issue early"
  exit 1
fi

log "5/5 sprint plan validates"
sprint_file=".planning/sprints/${SPRINT_ID}.json"
[ -f "$sprint_file" ] || { log "missing sprint plan: $sprint_file"; exit 4; }
if ! node "$(dirname "$0")/validate-plan.mjs" "$sprint_file" >&2; then
  exit 4
fi

log "preflight passed"
exit 0
