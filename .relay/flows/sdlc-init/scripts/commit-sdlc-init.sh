#!/usr/bin/env bash
# commit-sdlc-init.sh — single bootstrap commit on the `sdlc/init` branch.
#
# Inputs:  none.
# Outputs: one git commit and (best-effort) a push to the remote.
# Exit:    0 on success.
#
# Per §12, sdlc-init lands on `sdlc/init` as a single PR. This script is
# idempotent: if the branch already exists at the same content, it exits 0
# without re-committing. Push is best-effort — networks fail; the PR can be
# pushed manually.

SCRIPT_NAME="commit-sdlc-init"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

require_cmd git

branch="sdlc/init"

# If we're not in a repo, init one. The sdlc-init flow may run on a freshly
# cloned starter repo, so this is rare — but a useful safety net.
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "no git repository — initializing"
  git init -q
  git checkout -b "$branch" 2>/dev/null || git checkout "$branch"
fi

current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "$branch" ]; then
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout "$branch"
  else
    git checkout -b "$branch"
  fi
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
if git remote get-url origin >/dev/null 2>&1; then
  log "pushing $branch to origin"
  if ! git push -u origin "$branch" 2>&1 | tail -n 20; then
    log "push failed — leaving branch local; user can push manually"
  fi
else
  log "no origin remote — leaving branch local"
fi

exit 0
