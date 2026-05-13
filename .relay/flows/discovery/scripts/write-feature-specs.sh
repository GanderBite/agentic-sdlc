#!/usr/bin/env bash
# write-feature-specs.sh — final step of the discovery flow. Reads the
# `feature_list` handoff and emits one .planning/features/FEATURE-<slug>.md
# per feature plus an .planning/features/INDEX.json with the execution order.
#
# Inputs:  $RELAY_HANDOFFS_DIR/${HANDOFFS_PREFIX:+$HANDOFFS_PREFIX/}feature_list.json
# Outputs: .planning/features/FEATURE-<slug>.md (× N)
#          .planning/features/INDEX.json
# Exit:    0=ok, 1=missing input / write error.

SCRIPT_NAME="write-feature-specs"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd jq

handoffs="${RELAY_HANDOFFS_DIR:-}"
[ -n "$handoffs" ] && [ -d "$handoffs" ] || die 1 "RELAY_HANDOFFS_DIR not set or missing"
if [ -n "${HANDOFFS_PREFIX:-}" ]; then
  handoffs="$handoffs/$HANDOFFS_PREFIX"
  [ -d "$handoffs" ] || die 1 "HANDOFFS_PREFIX dir missing: $handoffs"
fi

feature_list="$handoffs/feature_list.json"
[ -f "$feature_list" ] || die 1 "missing handoff: $feature_list"

# Stage in a tempdir so a malformed entry doesn't leave .planning/features/
# half-written.
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT

mkdir -p .planning/features

count=$(jq '.features | length' "$feature_list")
[ "$count" -gt 0 ] || die 1 "feature_list contains zero features"

log "writing $count feature spec(s)"

# Build INDEX.json entries as we go.
index_entries="[]"

for i in $(seq 0 $((count - 1))); do
  feature=$(jq -c ".features[$i]" "$feature_list")
  slug=$(printf '%s' "$feature" | jq -r '.slug')
  title=$(printf '%s' "$feature" | jq -r '.title')
  est=$(printf '%s' "$feature" | jq -r '.estimated_task_count')
  [ -n "$slug" ] && [ "$slug" != "null" ] || die 1 "features[$i] missing slug"
  [ -n "$title" ] && [ "$title" != "null" ] || die 1 "features[$i] missing title"

  out="$staging/FEATURE-${slug}.md"

  # Frontmatter + body — kept terse so downstream `planning` can grep cleanly.
  {
    printf -- '---\n'
    printf 'slug: %s\n' "$slug"
    printf 'title: %s\n' "$(printf '%s' "$title" | jq -rR @json)"
    printf 'primary_users: %s\n' "$(printf '%s' "$feature" | jq -c '.primary_users')"
    printf 'depends_on: %s\n' "$(printf '%s' "$feature" | jq -c '.depends_on')"
    printf 'estimated_task_count: %s\n' "$est"
    printf -- '---\n\n'
    printf '# %s\n\n' "$title"
    printf '## Summary\n\n%s\n\n' "$(printf '%s' "$feature" | jq -r '.summary')"
    printf '## Scope\n\n'
    printf '%s' "$feature" | jq -r '.scope[] | "- " + .'
    printf '\n\n## Out of scope\n\n'
    printf '%s' "$feature" | jq -r '(.out_of_scope // [])[] | "- " + .'
    printf '\n\n## Acceptance bullets\n\n'
    printf '%s' "$feature" | jq -r '.acceptance_bullets[] | "- " + .'
    printf '\n'
  } > "$out"

  index_entries=$(jq -c \
    --arg slug "$slug" \
    --arg title "$title" \
    --argjson order "$i" \
    --argjson depends_on "$(printf '%s' "$feature" | jq -c '.depends_on')" \
    --argjson est "$est" \
    --arg spec_path ".planning/features/FEATURE-${slug}.md" \
    '. + [{slug: $slug, title: $title, order: $order, depends_on: $depends_on, estimated_task_count: $est, spec_path: $spec_path}]' \
    <<<"$index_entries")

  log "staged FEATURE-${slug}.md (est ${est} tasks)"
done

# Write INDEX.json into staging.
printf '%s\n' "$(jq -n --argjson features "$index_entries" '{
  generated_at: (now | todateiso8601),
  total: ($features | length),
  features: $features
}')" > "$staging/INDEX.json"

# Promote staging → .planning/features/. We DON'T wipe the directory first;
# repeated discovery runs may want to merge rather than overwrite. Each file
# is moved individually so a single failure leaves prior outputs intact.
for f in "$staging"/*; do
  mv -f "$f" ".planning/features/$(basename "$f")"
done

log "wrote $count feature spec(s) + INDEX.json to .planning/features/"
