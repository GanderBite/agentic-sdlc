#!/usr/bin/env bash
# build-report.sh — assemble the per-sprint HTML report.
#
# Inputs:  $SPRINT_ID env.
# Outputs: writes report.html to stdout. Relay redirects stdout into
#          <run>/artifacts/report.html.
# Exit:    0 always.
#
# The report is a single self-contained HTML page summarising the sprint:
# sprint metadata, wave outcomes, blocked-task index, retro link. open-pr.sh
# reads it from the artifacts dir to attach to the PR description.

SCRIPT_NAME="build-report"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq
require_env SPRINT_ID

sprint_file=".planning/sprints/${SPRINT_ID}.json"
state_file=".planning/state/${SPRINT_ID}.json"
retro_md=".planning/retros/${SPRINT_ID}.md"
blocked_dir=".planning/blocked/${SPRINT_ID}"

title="${SPRINT_ID}"
branch=""
if [ -f "$sprint_file" ]; then
  title=$(jq -r '.title // ""' "$sprint_file")
  branch=$(jq -r '.branch // ""' "$sprint_file")
fi

waves_table=""
if [ -f "$state_file" ]; then
  waves_table=$(jq -r '
    "<table><tr><th>Wave</th><th>Status</th><th>SHA</th></tr>" +
    ([.wave_status | to_entries[] |
       . as $w |
       (((.checkpoints // []) | map(select(.wave == $w.key)) | last) // null) as $c |
       "<tr><td>" + $w.key + "</td><td>" + $w.value + "</td><td>" + (($c.sha // "")|tostring) + "</td></tr>"
     ] | join("")) +
    "</table>"
  ' "$state_file" 2>/dev/null || true)
fi

blocked_html=""
if [ -d "$blocked_dir" ]; then
  blocked_count=$(find "$blocked_dir" -maxdepth 1 -name "*.md" | wc -l | tr -d ' ')
  if [ "$blocked_count" -gt 0 ]; then
    blocked_html="<h2>Blocked tasks</h2><ul>"
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      blocked_html+="<li><code>$(basename "$f")</code></li>"
    done < <(find "$blocked_dir" -maxdepth 1 -name "*.md")
    blocked_html+="</ul>"
  fi
fi

retro_html=""
if [ -f "$retro_md" ]; then
  retro_html="<h2>Retro</h2><p><a href=\"../../$retro_md\">$retro_md</a></p>"
fi

generated=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Emit a tiny self-contained HTML doc.
cat <<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sprint report — ${SPRINT_ID}</title>
  <style>
    body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1, h2 { border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: .35rem .6rem; text-align: left; }
    th { background: #f4f4f4; }
    code { background: #f4f4f4; padding: .1rem .25rem; border-radius: 3px; }
    .meta { color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${title:-$SPRINT_ID}</h1>
  <p class="meta">Sprint <code>${SPRINT_ID}</code> on branch <code>${branch}</code>. Generated ${generated}.</p>
  <h2>Waves</h2>
  ${waves_table:-<p>No state recorded yet.</p>}
  ${blocked_html}
  ${retro_html}
</body>
</html>
HTML
