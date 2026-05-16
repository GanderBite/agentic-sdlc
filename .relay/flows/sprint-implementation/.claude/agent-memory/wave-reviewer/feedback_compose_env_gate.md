---
name: feedback-compose-env-gate
description: Compose `docker compose config --quiet` gates with `${X:?...}` required-vars fail in a clean reviewer shell when no .env is committed; gate is environment-dependent.
metadata:
  type: feedback
---

When planner authors a `docker compose config --quiet` build gate AND the compose file uses `${VAR:?msg}` required-var syntax (correct for prod), the gate fails reproducibly in a clean shell because no `.env` exists in the worktree. Builders pass because their orchestration shell has the vars exported; reviewers in a fresh shell observe non-zero exit.

**Why:** sprint-001 wave-7 task-docker-compose: literal `docker compose config --quiet` exits 15 because POSTGRES_PASSWORD/JWT_SECRET use `?`-required and no `.env` is committed. With `.env.example` sourced, exit is 0 and the artifact is valid. The artifact is correct; the gate is brittle.

**How to apply:** flag this as a `high`/`architecture` finding (not blocking) — artifact is consumable. Recommend changing the planner gate to `docker compose --env-file .env.example config --quiet`, OR adding a `scripts/dev-bootstrap.sh` that copies `.env.example` to `.env` as part of pre-flight. Do NOT fail the wave on it; do call it out so the next sprint's planner fixes the gate.
