# INTEL — MedBridge (PoC)

> **Status: FRESH REPO.** No application source code on disk yet. This INTEL captures the seed description from `docs/APPLICATION.md` and the planned stack so downstream SDLC steps (brief / architecture / tech-stack / PRD) can reason about a real target — but every intel artefact below is a stub. Modules, build commands, schema, and hot-files will be regenerated once scaffolding lands and `intel-refresh` reruns.

Snapshot: `4ea7d103c254263c4eef97562c0d4b87f62edf17` (see `.planning/intel/.snapshot`).
Seed: `docs/APPLICATION.md`.
Playbook: `docs/AGENTIC_SDLC.md` (§4.1 defines this artefact).

---

## Product (from `docs/APPLICATION.md`)

**MedBridge** — a PoC scheduling app that lets patients book appointments with doctors quickly. Two roles (`Doctor`, `Patient`) with RBAC. Doctors configure slots and write appointment summaries. Patients maintain a medical record (medications, conditions, allergies, documents) and pick a specialization → optional doctor → slot when scheduling. All deletions are soft; uploaded medical documents (JPEG/PNG/PDF, ≤10 MB) live under `uploads/` with generated filenames.

### Auth & security (planned)
- JWT with refresh-token rotation, passwords hashed with `argon2`.
- CSRF via double-submit cookie; session cookies http-only + secure.
- No sign-up flow in PoC — Doctors and Patients are seeded.

### PoC trade-offs (frozen by the seed)
- Booked appointments are final (no cancel/reschedule).
- No in-app notifications.
- No UI tests, no e2e; backend gets unit + integration tests only.

---

## Planned Tech Stack (NOT YET ON DISK)

Captured here so the architecture and tech-stack steps inherit consistent defaults. Treat as **planned**, not detected.

| Layer | Choice |
|---|---|
| Repo layout | pnpm workspaces monorepo, two apps: `apps/ui`, `apps/api` |
| Node | v25 |
| Language | TypeScript (strict), Zod v4 for validation |
| UI | React + Vite, Tailwind v4, TanStack Router, TanStack Query, Shadcn UI |
| API | Node.js + Hono |
| Data | PostgreSQL via Drizzle ORM + Drizzle Kit migrations |
| Hosting | Docker Compose on a local machine |
| Testing (api only) | unit + integration (runner TBD by `tech-stack` step) |
| Accessibility | WCAG 2 AAA target |

> The intel-keeper does NOT pick a test runner / linter / builder on a fresh repo. The `tech-stack` step will decide; once scaffolding lands, `intel-refresh` will populate `build-graph.json` from the actual `package.json` scripts.

---

## What exists on disk right now

```
docs/
  AGENTIC_SDLC.md   playbook driving this flow
  APPLICATION.md    seed product description (this run's input)
scripts/
  _lib.sh           shell helpers for flow scripts
  validate-plan.mjs sprint-plan validator
.claude/            agent memory & skills (tooling, not product code)
.relay/             relay flow definitions (tooling, not product code)
```

No `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`, or `src/` yet.

---

## Intel surface (see `.planning/intel/`)

| File | Purpose | State |
|---|---|---|
| `modules.json` | Per-module facts (path, language, tests, deps, exports, owners) | empty array — no modules |
| `build-graph.json` | Tools + global/per-module/smoke commands | empty stubs — no commands to invoke |
| `conventions.md` | Naming, layering, errors, logging, boundaries, tests | placeholder; populate after scaffolding |
| `hot-files.md` | Files in >10% of last 200 commits | n/a — only meta/tooling history |
| `test-layout.md` | Where tests live, naming, fixtures, mocks | planned conventions only |
| `schema.md` | DB schema + migration tooling | none yet; Drizzle planned |
| `.snapshot` | `git rev-parse HEAD` at intel time | recorded |

---

## Downstream contract

- The `verify-intel` gate only checks that these files exist and exceed a minimum size; semantic content quality is enforced by reviewers.
- The `architecture`, `tech-stack`, and `prd` steps may freely propose stack choices — they should treat the "Planned Tech Stack" table above as the **seed**, not as committed facts.
- Once code lands, run `relay run intel-refresh` to repopulate `modules.json`, `build-graph.json`, `hot-files.md`, and `schema.md` from real source.
