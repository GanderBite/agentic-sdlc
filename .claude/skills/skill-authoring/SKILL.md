<!-- version: 1.0.0 -->

# skill-authoring

## Purpose

Defines how a skill package is structured, written, and registered so the linter accepts it and any pipeline agent can consume it. See `AGENTIC_SDLC.md §6` for the registry/loading model and `§19.3` for the linter rules this skill enforces. The full canonical rule set with stable IDs (P-1, S-3, W-2, SC-5, CV-1, PO-3, A-1…) lives in `references/guidelines.md` — cite IDs from there when rejecting or justifying a draft.

## Consumers

- `skill-author` (`.claude/agents/skill-author.md`) — produces one skill package per invocation.

## Philosophy

1. Skills encode KNOWLEDGE; agent prompts encode BEHAVIOR. A skill is a reference doc, not a system prompt — never address the reader as "you, the agent…".
2. Skills are shared libraries. Multiple agents Read the same `SKILL.md`; write for the broadest pipeline audience, not for one caller.
3. Skills are authoritative. Every rule must be enforceable and verifiable by inspection or by a script.
4. Skills are compact. Every token here competes with the agent's real work. Target ≤3k tokens; hard cap 5k.

## Rules

### Authoring style

1. Use direct imperatives only. Write "Use X.", "Never do Y.". Do not write "you should", "consider", "it's recommended".
2. One concept per numbered rule. Split rules joined by "and".
3. Show the shape, not the theory. Annotated example first, prose second.
4. Mark optionality explicitly with the literal prefix `OPTIONAL:`. Required is the default.
5. Omit motivational prose. Include a `WHY:` line only when the reason changes how an agent applies the rule.
6. Cross-reference, do not duplicate. When another skill or doc owns a schema, link to it by path and section.
7. Cache external content under `references/<topic>.md`. SKILL.md must contain zero `http(s)://` URLs (linter rule, §19.3).
8. Version the skill at the top of `SKILL.md` with an HTML comment: `<!-- version: x.y.z -->`. Bump on every meaningful edit.

### Schema-defining skills

9. Mark every field required or `OPTIONAL:`. Never leave it ambiguous.
10. List enum values exhaustively. Never write "etc.".
11. Provide both a COMPLETE example (every required field + at least one optional) and a MINIMAL skeleton.
12. Document constraints not expressible in the type system: cross-file references, no-cycles, max sizes, uniqueness.

### Convention skills (commit format, branch names, file naming)

13. Define the format as a template string with placeholders, e.g. `<type>(<scope>): <subject>`.
14. List every valid value for each constrained placeholder.
15. Include 3–5 realistic CORRECT examples spanning the range of allowed forms.
16. Include 2–3 INCORRECT examples; label each with the specific rule it violates.

### Policy skills (decision criteria)

17. Express decisions as IF/THEN rules or as a decision table. No prose decision trees.
18. Quantify every threshold. Replace "complex tasks" with `tasks touching > 5 files`. Replace "large file" with `tokens(file) > 4000`.
19. Include a CHECK-BEFORE-ACT command snippet for any rule that gates an irreversible action.
20. Add a "What can go wrong" subsection: 2–3 named failure modes plus the recovery action for each.

### Linter contract (§19.3) — mandatory

21. `SKILL.md` ≤ 5000 tokens, measured by tokenizer (not word count). Aim for ≤3000.
22. Every entry in `.claude/skills/INDEX.json` exists on disk; every skill on disk has an `INDEX.json` entry. One-to-one.
23. No two skills cover the same `domain` + `subdomain`. Check `INDEX.json` before authoring.
24. `SKILL.md` contains no `http(s)://` URLs.
25. Every new skill ships an `INDEX.json` entry matching the schema below (§6.2).

## Skill structure

```
.claude/skills/<skill-name>/
  SKILL.md              # entry point, ≤5k tokens (target ≤3k)
  references/
    <topic>.md          # deeper material, loaded on demand, no token cap
```

`SKILL.md` skeleton — copy and fill, do not omit sections:

```markdown
<!-- version: 0.1.0 -->

# <skill-name>

## Purpose
<1 sentence: what this skill encodes.>

## Consumers
- <agent name(s) that Read this skill>

## Rules
1. <imperative rule>
2. <imperative rule>
   ...

## <Schema | Format | Template>
<for schema/convention skills — see §Schema-defining or §Convention skills above>

## Examples
### CORRECT
<minimal working sample>

### INCORRECT
<sample + WHY: which rule it violates>

## OPTIONAL: Glossary
<only if domain terms aren't self-evident>
```

`references/` is mandatory only when SKILL.md would otherwise exceed budget. Split by topic, not by length.

## INDEX.json entry schema

The registry at `.claude/skills/INDEX.json` is one source of truth (§6.2). Each entry:

```json
{
  "name": "typescript",
  "version": "1.0.0",
  "domain": "language",
  "description": "Idiomatic TypeScript: types, generics, project structure.",
  "consumes": ["tsconfig.json", "package.json"],
  "produces": ["*.ts files"],
  "size_tokens": 3200
}
```

Fields:

- `name` (required): directory name under `.claude/skills/`. Kebab-case. Unique.
- `version` (required): semver string, matches the `<!-- version: -->` in `SKILL.md`.
- `domain` (required): one of `language | framework | data | api | testing | infra | process`.
- `description` (required): ≤120 chars; one-line summary the planner reads when picking skills.
- `consumes` (required, may be `[]`): glob patterns or filenames the skill references.
- `produces` (required, may be `[]`): glob patterns the skill helps generate.
- `size_tokens` (required): integer token count of `SKILL.md` only (not references). Used by §15 to budget builder context.

Append atomically: read, modify, write the whole file. Do not append-as-text.

## Anti-patterns

- The Encyclopedia — exhaustive coverage of the domain. FIX: keep only the 20% of rules that drive 80% of correct outputs; move the rest to `references/`.
- The Blog Post — motivational prose, narratives, "in this skill we will…". FIX: delete the prose; keep only rules and examples.
- The Suggestion Box — hedged language ("you might want to…", "consider whether…"). FIX: rewrite as direct imperatives or delete.
- The Clone — two skills with overlapping domain and contradictory rules. FIX: merge or cross-reference; one owner per concept.
- The Schema Orphan — a rule references a field/file/skill that is never defined or registered. FIX: every reference resolves; verify before merging.

## When NOT to write a skill

Do not author a skill if any of the following holds:

1. The knowledge is about WHAT or WHEN an agent acts (behavior). It belongs in the agent prompt under `.claude/agents/`, not in a skill.
2. An existing skill already covers the same `domain` + `subdomain` (check `INDEX.json`). Extend that skill instead.
3. The knowledge is a one-off project decision (architecture choice, chosen tech). Put it in `docs/ARCHITECTURE.md` or `docs/TECH_STACK.md`.
4. The knowledge is implementation detail of code the team owns. Put it in code or a code comment.

## Authoring checklist

Run through this list before declaring a skill done. Every item is a hard gate.

1. SKILL.md exists at `.claude/skills/<name>/SKILL.md`.
2. SKILL.md token count ≤ 5000 (target ≤ 3000), measured by tokenizer.
3. Top-of-file `<!-- version: x.y.z -->` present and matches the planned `INDEX.json` entry.
4. Sections present in order: Purpose, Consumers, Rules, (Schema | Format | Template if applicable), Examples (≥1 CORRECT + ≥1 INCORRECT).
5. Every rule is a direct imperative (no "should" / "consider" / "might").
6. Zero `http(s)://` URLs in SKILL.md. External content cached under `references/`.
7. Every referenced field, file, or skill resolves (no Schema Orphans).
8. INCORRECT examples are labeled with the specific rule number they violate.
9. Optional fields/sections explicitly prefixed `OPTIONAL:`.
10. No duplicate `domain` + `subdomain` against existing `INDEX.json` entries.
11. `INDEX.json` entry drafted with all required fields; `size_tokens` reflects the actual count.
12. `scripts/skill-linter.mjs` exits 0 on the new skill (run before declaring done).

## Process for adding a skill

See `references/process.md` for the full procedure (pre-flight, research, authoring, linting, branching). Summary: check `INDEX.json` for duplicates, author `SKILL.md` + `references/`, append the registry entry atomically, run the linter, land on a `skills/` branch (§6.5), human review before merge.

## Deeper reference

`references/guidelines.md` is the canonical rule set with stable IDs:

- **P-1…P-4** — philosophy (skills vs prompts, shared libraries, authoritative, compact)
- **S-1…S-6** — structure (Purpose, Consumers, numbered/imperative/verifiable rules, examples, ≤3k tokens)
- **W-1…W-8** — writing rules (direct imperatives, one concept per rule, concrete, optionality, no prose, cross-reference, version)
- **SC-1…SC-6** — schema-defining skills (required/optional, exhaustive enums, COMPLETE + MINIMAL examples)
- **CV-1…CV-5** — convention skills (template strings, exhaustive placeholders, 3–5 correct + 2–3 incorrect examples, edge cases)
- **PO-1…PO-4** — policy skills (IF/THEN, quantified thresholds, CHECK-BEFORE-ACT snippets, "what can go wrong")
- **A-1…A-5** — anti-patterns (Encyclopedia, Blog Post, Suggestion Box, Clone, Schema Orphan)

Quote IDs verbatim when reviewing or justifying a skill: "rejected — violates W-1 and SC-2".

## Examples

### CORRECT — a tiny well-formed skill (`.claude/skills/conventional-commits/SKILL.md`)

```markdown
<!-- version: 1.0.0 -->

# conventional-commits

## Purpose
Format every commit subject as `<type>(<scope>): <subject>` per Conventional Commits 1.0.

## Consumers
- builder, reviewer

## Rules
1. Use one of these `<type>` values: `feat | fix | refactor | docs | test | chore | perf | build | ci`.
2. Use a lowercase `<scope>` taken from `.planning/intel/modules.json#name`.
3. Write `<subject>` in the imperative mood, ≤72 chars, no trailing period.
4. Never write multi-line subjects. Body goes after a blank line.

## Format
`<type>(<scope>): <subject>`

## Examples
### CORRECT
- `feat(resource): add soft-delete column`
- `fix(auth): reject expired session tokens`
- `refactor(common): extract retry helper`

### INCORRECT
- `Added soft delete.`           — violates Rule 1 (missing type) and Rule 3 (capitalized, past tense).
- `feat: stuff`                  — violates Rule 2 (missing scope).
- `feat(resource): adds a soft-delete column to make the model support recoverable deletions.` — violates Rule 3 (>72 chars, present tense).
```

### INCORRECT — a Suggestion Box / Encyclopedia excerpt

```markdown
# typescript-style

When writing TypeScript, you should generally consider whether `any` is the right
choice. In most cases, you'll find that a more specific type is preferable. There
are many situations where developers reach for `any` out of habit; this guide
will walk you through the philosophical underpinnings of TypeScript's type system
and help you build intuition for when narrower types are appropriate...
```

WHY this is wrong:

- Rule 1 violated: hedged language ("should generally consider", "you'll find"). The Suggestion Box anti-pattern.
- Rule 5 violated: motivational prose ("philosophical underpinnings", "build intuition"). The Blog Post anti-pattern.
- Rule 3 violated: theory before example; no shape shown.
- No numbered rules, no Examples section, no `<!-- version: -->`. Fails the structural contract.

FIX: replace with rules like `Never use `any`; use `unknown` and narrow it.` plus CORRECT/INCORRECT code samples.
