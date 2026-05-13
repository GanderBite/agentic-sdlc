# Process for adding a skill

This is the full procedure the `skill-author` agent follows to land a new skill. It expands the summary in `SKILL.md`. See `AGENTIC_SDLC.md §6` and `§19.3` for context.

## 1. Pre-flight

1. Read `.claude/skills/INDEX.json`. If it does not exist, the orchestrator will create it after the starter pack lands; do not create it yourself during `sdlc-init` skill authoring.
2. Search the registry for an existing skill with the same `domain + subdomain`. If found, abort and return a conflict report. Do not author a competing skill — extend the existing one instead.
3. Verify `.claude/skills/<skill_name>/` does not already exist on disk. If it does, abort and ask the human whether to overwrite.

## 2. Research (only when a public domain target exists)

1. Use `WebFetch` to retrieve official documentation for the target framework or library. The `skill-author` agent has `WebFetch` in its tools allowlist (§14.7).
2. Cache every relevant excerpt locally under `references/<topic>.md`. Cite by relative path from `SKILL.md`.
3. Never paste an `http(s)://` URL into `SKILL.md` — the linter (§19.3) rejects it.
4. Cross-reference the project's `docs/TECH_STACK.md` and `docs/ARCHITECTURE.md`. Project conventions override generic framework idioms.

## 3. Author SKILL.md

1. Use the skeleton in `SKILL.md → Skill structure`.
2. Hard cap 5000 tokens; target ≤3000. Measure with a tokenizer, not word count. The orchestrator's planner reads `size_tokens` from `INDEX.json` to budget builder context (§15.2).
3. Apply the authoring rules (Rules 1–8 in `SKILL.md`).
4. If the skill defines a schema, apply schema-defining rules (Rules 9–12).
5. If the skill defines a convention, apply convention rules (Rules 13–16).
6. If the skill encodes policy, apply policy rules (Rules 17–20).
7. Add at least one CORRECT and one INCORRECT example. Label each INCORRECT example with the rule number it violates.

## 4. Author references/

1. Split deeper material by topic, not by length. One file per topic.
2. References have no token cap but should remain focused — one topic per file.
3. SKILL.md links to references with relative paths only (`references/<topic>.md`).

## 5. Update INDEX.json (atomic)

1. Read `.claude/skills/INDEX.json` into memory.
2. Append the new entry per the schema in `SKILL.md → INDEX.json entry schema`.
3. Write the whole file back with 2-space indent. Do not append as text — that risks malformed JSON.
4. Re-read the file and parse it as JSON to confirm the write succeeded.

Note: during `sdlc-init`, the orchestrator may build `INDEX.json` after all process skills land rather than each skill-author appending its own entry. Follow the orchestration prompt's instructions on this point.

## 6. Lint

1. Run `node scripts/skill-linter.mjs`. The linter checks (§19.3):
   - SKILL.md ≤ 5000 tokens.
   - Every `INDEX.json` entry has a directory; every directory has an entry.
   - No duplicate `domain + subdomain`.
   - No `http(s)://` URLs in any SKILL.md.
2. Fix every reported error before proceeding. The linter is non-negotiable; a failing skill blocks the merge.

## 7. Branch and review

1. New skills land on a dedicated `skills/<skill-name>` branch, separate from feature work (§6.5, §12.1).
2. The PR contains only skill additions. Feature PRs never touch `.claude/skills/INDEX.json`.
3. Human review is required before merge to `main` (§13).

## 8. Common pitfalls

| Pitfall | How it manifests | Recovery |
|---|---|---|
| Skill exceeds 5k tokens | Linter exit 1 | Move bulk into `references/<topic>.md`; SKILL.md keeps only rules + examples. |
| Duplicate domain | Linter exit 1 with "duplicate domain" | Delete the new skill; extend the existing one with a new section or a new `references/` file. |
| Schema Orphan | Builder reads SKILL.md, references a field that does not exist in any schema | Add the field's definition or remove the reference. Bump version. |
| Hedged language slips in | Reviewer flags "consider", "might", "should" | Rewrite as imperative or delete. |
| Skill drifts from agent prompt | A rule contradicts an agent's system prompt | The agent prompt wins for behavior; the skill wins for knowledge. Reconcile and bump versions on both. |
