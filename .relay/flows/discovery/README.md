# discovery

Decompose a raw application idea into per-feature specs.

## What it does

1. Reads `docs/APPLICATION.md` (or whatever `appIdea` input points at) plus the
   bootstrapped context (ARCHITECTURE.md, TECH_STACK.md, PRD.md, INTEL.md).
2. Emits a single round of biz/tech clarification questions (each select/
   multiselect option marks one entry with the literal ` (recommended)` suffix).
3. Synthesises the answers into a clarified application brief and decomposes
   it into vertical-slice features sized at 5-15 tasks each.
4. Writes one `.planning/features/FEATURE-<slug>.md` per feature plus an
   `.planning/features/INDEX.json` listing slugs in execution order.

## Pipeline position

```
sdlc-init  →  discovery  →  planning (× N features)  →  sprint-implementation (× N sprints)
```

`discovery` is the bridge between "I have a project bootstrapped" and "I have
sprints to run". Each `FEATURE-*.md` it writes becomes the `featureSpec` input
to one `planning` run, which produces exactly one sprint.

## Run

```bash
relay run .relay/flows/discovery -- --input appIdea=docs/APPLICATION.md
```

## Output layout

```
.planning/features/
  INDEX.json                          # ordered slug list + metadata
  FEATURE-patient-portal-auth.md      # one spec per feature
  FEATURE-doctor-scheduling.md
  ...
```

Each `FEATURE-*.md` carries frontmatter (slug, title, primary_users,
depends_on, estimated_task_count) plus body sections (summary, scope,
out_of_scope, acceptance_bullets).

## Cost + duration

- $0.30–$2.00 per run (Opus on the two prompt steps; bounded by the size of
  the raw idea and the bootstrapped context).
- 5–30 minutes wall-clock, dominated by the one human-input pause in
  `ask-clarify`.

## License

MIT.
