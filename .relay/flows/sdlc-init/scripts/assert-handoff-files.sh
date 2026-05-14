#!/usr/bin/env bash
# assert-handoff-files.sh — verification gate run AFTER any file-producing
# prompt step in sdlc-init. Reads the named handoff, extracts the list of
# file paths the prompt claimed to write, and asserts each one exists on
# disk and is non-empty. Catches the LLM-hallucination failure mode where
# a prompt step reports `architecture_path: "docs/ARCHITECTURE.md"` in its
# handoff but never actually called Write.
#
# Env (set by flow.ts on each verify-* step):
#   HANDOFF_NAME       — name of the handoff to inspect (e.g. "architecture",
#                        "intel"). Resolves to $RELAY_HANDOFFS_DIR/$HANDOFF_NAME.json.
#   PATHS_JQ           — jq expression extracting an array of paths from the
#                        handoff. Examples:
#                          '[.architecture_path]'
#                          '.files_written // []'
#                          '[.intel_md_path] + (.planning_intel_paths // [])'
#   MIN_BYTES          — optional. Files smaller than this fail. Default 64.
#
# Exit: 0 = all files exist and meet size requirement.
#       1 = any file missing, empty, or too small.
#       2 = bad env / handoff missing / jq parse error.

SCRIPT_NAME="assert-handoff-files"
# shellcheck source=../../../../scripts/_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env HANDOFF_NAME PATHS_JQ RELAY_HANDOFFS_DIR

handoff="$RELAY_HANDOFFS_DIR/${HANDOFF_NAME}.json"
[ -f "$handoff" ] || die 2 "handoff not found: $handoff"

min_bytes="${MIN_BYTES:-64}"

# Extract the file path list. jq -e fails on empty/null arrays so we can
# diagnose a malformed PATHS_JQ expression vs a legitimately empty list.
paths_json=$(jq -c "$PATHS_JQ" "$handoff") || die 2 "PATHS_JQ failed against $handoff: $PATHS_JQ"
if [ "$paths_json" = "null" ] || [ "$paths_json" = "[]" ]; then
  log "no paths in handoff (PATHS_JQ=$PATHS_JQ) — nothing to verify"
  exit 0
fi

# Walk each path. Capture all missing/empty entries before failing so the
# diagnostic lists everything at once.
missing=()
small=()
while IFS= read -r p; do
  if [ ! -f "$p" ]; then
    missing+=("$p")
    continue
  fi
  size=$(wc -c < "$p" | tr -d ' ')
  if [ "$size" -lt "$min_bytes" ]; then
    small+=("$p ($size bytes < $min_bytes)")
  fi
done < <(jq -r '.[]' <<<"$paths_json")

if [ ${#missing[@]} -gt 0 ] || [ ${#small[@]} -gt 0 ]; then
  log "verification FAILED for handoff $HANDOFF_NAME"
  if [ ${#missing[@]} -gt 0 ]; then
    log "  missing on disk:"
    for p in "${missing[@]}"; do log "    - $p"; done
  fi
  if [ ${#small[@]} -gt 0 ]; then
    log "  too small (< $min_bytes bytes):"
    for p in "${small[@]}"; do log "    - $p"; done
  fi
  log "the prompt step reported these files in its handoff but did not actually write them"
  log "(or wrote stubs). Retry will re-invoke the prompt with the same context."
  exit 1
fi

count=$(jq -r 'length' <<<"$paths_json")
log "✓ verified $count file(s) from handoff $HANDOFF_NAME"
