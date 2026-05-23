#!/usr/bin/env bash
# commit-sdlc-init.sh — single bootstrap commit on the `sdlc/init` branch.
#
# Inputs:  none — branch.sh has already parked us on sdlc/init.
# Outputs: one git commit, best-effort push, best-effort PR.
# Exit:    0 on success or no-op.

SCRIPT_NAME="commit-sdlc-init"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/init"
current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$current" != "$branch" ]; then
  die 1 "expected to be on $branch but on $current — did branch.sh run?"
fi

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  log "no changes to commit — sdlc/init already up-to-date"
  exit 0
fi

# Stage canonical sdlc-init outputs only — never blanket-add to keep
# stray local files out.
to_add=()
for path in docs/ARCHITECTURE.md docs/TECH_STACK.md docs/PRD.md docs/INTEL.md \
            docs/APPLICATION_BRIEF.md .planning/intel .claude/skills; do
  [ -e "$path" ] && to_add+=("$path")
done
[ "${#to_add[@]}" -eq 0 ] && die 0 "nothing to add"

git add "${to_add[@]}"

git commit -m "$(cat <<'EOF'
chore(sdlc): bootstrap project artifacts

- ARCHITECTURE.md, TECH_STACK.md, PRD.md, APPLICATION_BRIEF.md
- INTEL.md and .planning/intel/* snapshot
- starter .claude/skills/* per the chosen tech stack
EOF
)"

# Best-effort push if a remote is configured.
has_remote=0
if git remote get-url origin >/dev/null 2>&1; then
  has_remote=1
  log "pushing $branch to origin (force-with-lease)"
  if ! git push --force-with-lease -u origin "$branch" 2>&1 | tail -n 20; then
    log "push failed — leaving branch local; user can push manually"
  fi
else
  log "no origin remote — leaving branch local"
fi

# Best-effort PR creation/update. Mirrors the other flows' commit-and-pr.sh
# scripts so every flow leaves the user with a reviewable PR rather than
# just a pushed branch.
if [ "$has_remote" = "1" ] && command -v gh >/dev/null 2>&1; then
  body_file=$(mktemp)
  trap 'rm -f "$body_file"' EXIT
  {
    printf '## Summary\n\nBootstrap SDLC artifacts produced by `relay run sdlc-init`.\n\n'
    printf '## Outputs\n\n'
    printf -- '- `docs/ARCHITECTURE.md` — high-level architecture\n'
    printf -- '- `docs/TECH_STACK.md` — chosen stack\n'
    printf -- '- `docs/PRD.md` — product requirements\n'
    printf -- '- `docs/APPLICATION_BRIEF.md` — enriched brief\n'
    printf -- '- `docs/INTEL.md` + `.planning/intel/*` — codebase intel snapshot\n'
    printf -- '- `.claude/skills/*` — starter skill set per the chosen stack\n\n'
    printf '## Next\n\nRun `relay run discovery` to decompose the application into features.\n\n'
    printf '🤖 Opened by relay run sdlc-init\n'
  } >"$body_file"

  existing=$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)
  if [ -z "$existing" ]; then
    log "creating PR for $branch"
    set +e
    gh pr create \
      --base main \
      --head "$branch" \
      --title "sdlc/init: bootstrap project artifacts" \
      --body-file "$body_file" 2>&1 | tail -n 5
    set -e
  else
    log "updating existing PR: $existing"
    gh pr edit "$existing" --body-file "$body_file" >/dev/null 2>&1 || \
      log "gh pr edit failed — leaving PR as-is"
  fi
fi

exit 0
