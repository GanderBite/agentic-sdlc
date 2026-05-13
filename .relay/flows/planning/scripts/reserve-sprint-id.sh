#!/usr/bin/env bash
# reserve-sprint-id.sh — atomically claim the next sprint id.
#
# Inputs:  none.
# Outputs: the new sprint id on stdout, e.g. "sprint-007".
# Exit:    0 on success, 1 if the lock can't be acquired in 5 s.
#
# Per AGENTIC_SDLC.md §12.1 multi-developer coordination: appends the new id
# to .planning/sprints/.reserved. Cross-developer coordination ultimately
# happens via merging this file into `main` — within a single working tree,
# this script uses mkdir-based locking (portable POSIX, no flock/lockf
# dependency) so two parallel `relay run planning` invocations on the same
# machine cannot claim the same id.

SCRIPT_NAME="reserve-sprint-id"
# shellcheck source=_lib.sh
. "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/_lib.sh"

cd "$(project_root)"

reserved=".planning/sprints/.reserved"
lockdir=".planning/sprints/.reserved.lock.d"
mkdir -p "$(dirname "$reserved")"
touch "$reserved"

# mkdir is atomic across POSIX file systems — used as a lock.
i=0
until mkdir "$lockdir" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    die 1 "could not acquire $lockdir after 5s — stale lock? remove it manually"
  fi
  sleep 0.1
done
trap 'rmdir "$lockdir" 2>/dev/null || true' EXIT INT TERM

if [ -s "$reserved" ]; then
  n=$(awk -F- '/^sprint-/{ if ($2+0 > max) max=$2+0 } END { print max+0 }' "$reserved")
else
  n=0
fi
next=$((n + 1))
printf 'sprint-%03d\n' "$next" >>"$reserved"
printf 'sprint-%03d\n' "$next"
