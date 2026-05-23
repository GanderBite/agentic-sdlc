#!/usr/bin/env bash
# Shared helpers sourced by every scripts/*.sh.
# Keeps the per-script boilerplate down: strict mode, project root cd,
# logger, JSON helpers (via jq), atomic writes.

# Strict mode. `pipefail` is required so commands like `cmd | jq` propagate
# upstream failures.
set -Eeuo pipefail

# Resolve the project root once. Most scripts operate on docs/, .planning/,
# .claude/ etc., which all live alongside .git. Falling back to PWD lets the
# bootstrap script run before git init.
project_root() {
  if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$root"
  else
    printf '%s\n' "$PWD"
  fi
}

log() {
  printf '[%s] %s\n' "${SCRIPT_NAME:-script}" "$*" >&2
}

die() {
  local exit_code="$1"; shift
  log "ERROR: $*"
  exit "$exit_code"
}

require_cmd() {
  local missing=()
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die 1 "missing required tools on PATH: ${missing[*]}"
  fi
}

require_env() {
  local missing=()
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      missing+=("$v")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    die 1 "missing required env vars: ${missing[*]}"
  fi
}

# atomic_write <dest> — read stdin into dest via temp + mv.
atomic_write() {
  local dest="$1"
  local dir
  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  local tmp
  tmp="$(mktemp "${dir}/.${SCRIPT_NAME:-tmp}.XXXXXX")"
  cat >"$tmp"
  mv -f "$tmp" "$dest"
}

# epoch_ms — print current Unix time in milliseconds.
# Portable across GNU coreutils and BSD `date`. macOS ships BSD `date`, which
# does not support `%N`/`%3N`, so `date +%s%3N` emits a literal `N` and
# produces garbage. Prefer `gdate` (Homebrew coreutils) if installed, then
# fall back to `perl` (present on every macOS and most Linux distros).
# Last-resort fallback is whole-second precision so the script keeps running
# even if neither is available.
epoch_ms() {
  if command -v gdate >/dev/null 2>&1; then
    gdate +%s%3N
  elif command -v perl >/dev/null 2>&1; then
    perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'
  else
    printf '%s000\n' "$(date +%s)"
  fi
}

# slugify <string> — produces a kebab-case id-safe slug.
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-60
}
