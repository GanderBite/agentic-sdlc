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

# slugify <string> — produces a kebab-case id-safe slug.
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | cut -c1-60
}
