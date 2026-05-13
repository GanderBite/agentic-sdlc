<!-- version: 1.0.0 -->
# brain-storming

## Purpose

Directed-question protocol that turns a vague feature brief into an unambiguous `enriched_brief.md` whose acceptance bullets are mechanically verifiable downstream.

## Consumers

- **`feature-brief-brainstormer`** (`.claude/agents/feature-brief-brainstormer.md`) — the only agent that loads this skill. It uses the gap checklist to scan inputs, the question rubric to gate every question, and the `enriched_brief.md` template as its terminal artifact. The brief is then consumed by the `planning` flow's `compose-tasks` step and validated by `scripts/validate-plan.mjs` (see AGENTIC_SDLC.md §19.1).

## Rules

### R1 — Read inputs before producing anything
1. Read the supplied feature brief in full.
2. Read `docs/INTEL.md`, `docs/ARCHITECTURE.md`, `docs/PRD.md`. If any is missing, record `MISSING: <file>` in your scratchpad and proceed.
3. If the brief explicitly cites a file (e.g. `.planning/intel/schema.md`), read it before round 1.
4. Never ask a question whose answer appears verbatim or by clear implication in any of the above.

### R2 — Run the gap checklist on every round
Scan six dimensions, in order. A gap exists when any sub-check is unanswered by brief + project context.

1. **Auth** — actor identity (anon/user/admin/service); permission model (role/scope/row-level); session boundary; rate-limit policy.
2. **Data model** — entities created/extended; new fields & types; relationships & cascades; persistence (table/collection/cache/none); migration vs. code-only.
3. **Error paths** — input-validation failures; downstream failures (timeout/5xx/partial); retry & idempotency; user-visible vs. logged-only.
4. **Performance constraints** — p50/p95 latency; throughput/concurrency; payload-size bound; cache TTL or invalidation rule.
5. **UI scope** — surfaces in scope (page/modal/API-only); states (loading/empty/error/success); explicit out-of-scope surfaces; accessibility floor when UI applies.
6. **Success metrics** — observable signal (event/log/metric); threshold or comparator; window; instrumentation owner.

### R3 — Each question must satisfy the rubric

A question is admissible only if all six hold:
1. **Blocking.** A wrong answer would force re-work in **≥1 sprint task** (i.e. would invalidate `target_files`, `verification`, or a wave dependency in §5.1.1). Anything looser is *nice-to-know* and must be cut.
2. **Specific.** Binary or multiple-choice; not open-ended ("what do you want?").
3. **≤2 sentences.**
4. **Carries a recommendation** of the form: `Recommendation: <answer> (because <citation: brief / INTEL §X / ARCHITECTURE §Y / PRD §Z>).` The citation must point at a real section.
5. **Not already answered** by brief, INTEL, ARCHITECTURE, or PRD.
6. **Not aesthetic** (color, copy, naming) unless explicitly scoped as blocking by the brief.

### R4 — Round protocol (≤3 rounds, ≤4 questions per round)

1. **Round 1** — highest-impact gaps. Pick the ≤4 questions whose wrong answers would invalidate the most tasks. Auth and data model are usually here.
2. **Round 2** — second-order gaps **revealed by Round 1 answers** (e.g. a chosen permission model now requires a question about admin override paths). Do not ask a Round 2 question whose answer was already implied by Round 1.
3. **Round 3** — remaining edge cases (error paths, perf thresholds, metric thresholds). After Round 3, terminate even if gaps remain.
4. Terminate **early** when the gap checklist has zero unresolved sub-checks. Do not pad rounds.

### R5 — After Round 3, always emit `enriched_brief.md`
1. Use your recommended answers as defaults for any unresolved gap.
2. List every still-unresolved sub-check under `## Open questions` so the planner can route it via `step.ask` in the `planning` flow.
3. Emit even if `## Open questions` is non-empty — best-effort delivery is a hard requirement.

### R6 — Acceptance-bullet phrasing (load-bearing)
Every bullet under `## Acceptance` in `enriched_brief.md` must be writable as **one mechanical check** the planner can encode in a `task.verification` block (see AGENTIC_SDLC.md §19.1 — the plan validator rejects sprints whose acceptance bullets do not map to ≥1 verification gate).

A bullet is admissible only if it can be paraphrased as one of:
- "Test `<file or pattern>` exists and passes."
- "Command `<cmd>` exits 0 with `<observable>`."
- "File `<path>` exists / contains `<symbol>` (provable via `rg --quiet`)."
- "Endpoint `<method> <path>` returns `<status>` for `<input class>`."

Reject prose like "the system should feel responsive" or "users will love it" — rewrite or drop.

### R7 — Per-round output shape
Each round emits a single JSON block (machine-readable) followed by a human-readable rendering. The JSON is what downstream tooling consumes; see the schema in **Schema / Format / Template** below.

### R8 — Hard prohibitions
1. Never ask >4 questions in a round.
2. Never run a 4th round.
3. Never ask a question already answered by brief / INTEL / ARCHITECTURE / PRD.
4. Never ask an aesthetic / open-ended / nice-to-know question.
5. Never produce prose-only acceptance bullets that R6 would reject.
6. Never invent file references; cite only files that exist.

## Schema / Format / Template

### Per-round question block (emitted at the end of rounds 1–3)

```json
{
  "round": 1,
  "gaps_identified": [
    { "dimension": "auth",       "subcheck": "actor identity",      "rationale": "brief says 'users' but doesn't distinguish anon vs. signed-in" },
    { "dimension": "data_model", "subcheck": "new fields and types", "rationale": "soft-delete column not specified" }
  ],
  "questions": [
    {
      "id": "q1",
      "dimension": "auth",
      "text": "Should anonymous users see the read-only listing, or be redirected to sign-in?",
      "recommendation": "redirect to sign-in",
      "citation": "ARCHITECTURE.md §Routing — all non-/public routes require auth",
      "blocking_reason": "decides whether tasks need a public-route guard task"
    }
  ]
}
```

### `enriched_brief.md` template (terminal artifact)

```markdown
# Enriched Brief: <Feature Name>

## Overview
<1 paragraph: unambiguous statement of what is being built. No marketing tone.>

## Scope (in)
- <bullet>

## Non-goals (out)
- <bullet>

## Acceptance
<!-- Each bullet MUST be writable as one mechanical check per R6.
     The compose-tasks step maps each bullet to ≥1 task.verification gate
     (AGENTIC_SDLC.md §19.1 — coverage check rejects prose-only bullets). -->
- `POST /resources/:id/archive` returns 200 with `{ archivedAt }` for authenticated owner.
- `POST /resources/:id/archive` returns 403 for a non-owner.
- File `src/modules/resource/archive.ts` exists and exports `archiveResource`.
- `pnpm test --filter resource` exits 0.

## Authentication & authorization
- Actor / permission model / session boundary / rate-limit policy.

## Data model touchpoints
- Entities created / extended; new fields & types; relationships & cascades; migration tool (or none).

## Error paths
- Input-validation; downstream failures; retry & idempotency; user-visible vs. logged-only.

## Performance constraints
- p50/p95 latency; throughput; payload-size bound; cache rule.

## UI scope
- In: <surfaces>. States: <loading|empty|error|success>. Out: <surfaces>. Accessibility floor: <…>.

## Success metrics
- Signal (event/log/metric); threshold; window; instrumentation owner.

## Open questions  <!-- only present if gaps remain after round 3 -->
- <unresolved sub-check> — default applied: <recommended answer>; resolve via `step.ask` before sprint execution.
```

## Examples

### Correct walkthrough (compressed)

**Input brief:** "Add archive functionality to Resources. Owners should be able to hide a resource."

**Round 1 (4 blocking questions):**
1. Actor: owner only or any signed-in user? *Rec: owner only (PRD §3 — owner-scoped mutations).*
2. New `archivedAt` column or separate `archives` table? *Rec: `archivedAt` on `resource` (INTEL `schema.md` soft-delete precedent).*
3. Listing default-filters archived rows? *Rec: yes; `?includeArchived=true` opts in (matches `deletedAt` pattern).*
4. p95 latency target? *Rec: <200ms (PRD §6).*

**Round 2 (2 questions, revealed by R1):**
1. Non-owner archive attempt — 403 or 404? *Rec: 404 (ARCHITECTURE §Auth — leak-resistant).*
2. Idempotent re-archive? *Rec: yes, return original `archivedAt` (avoids audit-log churn).*

**Terminate early** — gap checklist clean. Skip Round 3.

**Acceptance bullets emitted (all R6-compliant):**
- `POST /resources/:id/archive` returns 200 with `{ archivedAt }` for authenticated owner.
- `POST /resources/:id/archive` returns 404 for non-owner.
- Re-archiving returns the original `archivedAt`.
- `GET /resources` excludes `archivedAt IS NOT NULL` unless `?includeArchived=true`.
- `pnpm test --filter resource` exits 0.

### Incorrect examples (and why)

| Bad question | Violation | Fix |
|---|---|---|
| "What should the archive feature do?" | R3.2 (open-ended), R3.1 (not blocking — every task fails) | Replace with a binary scoped question. |
| "Should we use a fancy animation when archiving?" | R3.6 (aesthetic), R3.1 (not blocking) | Cut. |
| "Should the database use Postgres?" | R1.4 (already in TECH_STACK / INTEL) | Re-read INTEL before asking. |
| Round 1 with 5 questions | R8.1 | Drop the lowest-impact one. |
| Round 4 to "wrap up loose ends" | R8.2 | Emit `enriched_brief.md` with `## Open questions`. |

| Bad acceptance bullet | Violation | Fix |
|---|---|---|
| "Archiving feels fast" | R6 (no mechanical check) | "p95 of `POST /resources/:id/archive` < 200ms under 50 RPS." |
| "Users can archive things" | R6 (vague) | "`POST /resources/:id/archive` returns 200 with `{ archivedAt }` for authenticated owner." |
| "Code quality is good" | R6 (not mechanical) | "Command `pnpm lint --filter resource` exits 0." |

## Glossary

- **Blocking question** — one whose wrong answer forces re-work in ≥1 sprint task (per R3.1). Stricter than "useful to know."
- **Mechanical check** — a command, file existence, or HTTP-level assertion that exits 0/non-0 deterministically (per R6).
- **Sub-check** — one of the bulleted items inside a gap-checklist dimension (R2). The unit of "is this gap closed?"
- **Round** — one batch of ≤4 questions. ≤3 rounds total, then terminate.
