<!-- version: 1.0.0 -->

# Skill-authoring guidelines (canonical reference)

The deep reference behind `SKILL.md`. Every rule below is citable by its ID
(`P-1`, `S-3`, `W-2`, `SC-5`, `CV-1`, `PO-3`, etc.). Reviewers and skill-authors
quote these IDs when justifying decisions or rejecting drafts.

---

## 1. Philosophy — what skills are (and are not)

### P-1. Skills are reference docs, not prompts
A skill encodes KNOWLEDGE — conventions, schemas, rules, patterns. An agent
prompt encodes BEHAVIOR — what to do, when, and how. Skills are READ BY agents.
Prompts ARE agents. Never write a skill that addresses the reader as
"you are an agent that…" — that belongs in the agent prompt, not the skill.

### P-2. Skills are shared libraries
Multiple agents in the pipeline read the same skill. A skill must make sense
to ANY agent that consumes it — from the wave-runner reading `verification-gates`
to decide retry policy, to the wave-reviewer reading the same skill to gate
the wave verdict. Write for the broadest audience within the pipeline.

### P-3. Skills are authoritative
When a skill says "commit messages MUST follow this format," that is law. Skills
are not suggestions or guidelines — they are the single source of truth for
their domain. Every rule must be enforceable and verifiable.

### P-4. Skills are compact
Skills get injected into agent context windows alongside task specs, code
excerpts, and other skills. Every unnecessary token in a skill steals capacity
from the agent's real work. Ruthlessly compress. A 2,000-token skill that
covers everything beats a 5,000-token skill that covers the same things with
more prose.

---

## 2. Structure

Every `SKILL.md` follows a consistent structure. Predictable layout means
agents find information faster with less scanning.

### Canonical layout

```markdown
<!-- version: x.y.z -->

# [Skill Name]

## Purpose
One sentence: what this skill codifies and why it exists.

## Consumers
Which agents/roles read this skill and what they use it for.

## Rules
Numbered, imperative rules. Each rule is one sentence.
Rules are the core of the skill — everything else supports them.

## Schema | Format | Template
The concrete artifact shape this skill defines.
Use code blocks with annotated examples.

## Examples
### CORRECT
A complete, realistic example of correct usage.

### INCORRECT
A common mistake with explanation of WHY it's wrong.

## OPTIONAL: Glossary
Terms that have specific meanings in this pipeline.
```

### Structural rules

- **S-1.** Start with a one-line `Purpose`. An agent that reads only this
  line should know whether the skill is relevant to its current task.
- **S-2.** List `Consumers` explicitly. This tells skill authors who they are
  writing for and tells agents whether to read the skill at all.
- **S-3.** Rules are NUMBERED and IMPERATIVE. "1. Use conventional commit
  format." not "It's generally a good idea to use conventional commits."
  Numbered rules are referenceable: "violates `commit-atomicity` rule 3."
- **S-4.** Every rule must be VERIFIABLE. Another agent or a script must be
  able to check whether the rule was followed. "Write clean code" is not
  verifiable. "Every function must have a return type annotation" is.
- **S-5.** Include at least one CORRECT and one INCORRECT example. Agents
  learn more from seeing what NOT to do than from rules alone. Mark INCORRECT
  examples clearly with WHY they are wrong (cite the rule number).
- **S-6.** Keep the skill under 3,000 tokens. Hard cap 5,000 (linter, §19.3).
  If it exceeds the target, split into two skills or aggressively compress
  prose into rules + examples. Measure by tokenizer, not word count.

---

## 3. Writing rules

- **W-1. Direct imperatives only.** "Use X." "Never do Y." "Always include Z."
  Not: "You should consider using X.", "It's recommended to include Z."
  Hedged language in a skill produces hedged compliance.
- **W-2. One concept per rule.** Each numbered rule covers exactly one
  constraint. If a rule has "and" joining two unrelated constraints, split
  into two rules. Combined rules get partially followed.
- **W-3. Concrete over abstract.** "Branch name format:
  `feat/{issue-number}-{slug}`" is useful. "Use descriptive branch names" is
  not. Every rule should let the reader produce a correct output without
  additional judgment.
- **W-4. Show the shape, not the theory.** For schemas and formats, show an
  annotated example first, then explain the rules. Agents parse examples
  faster than prose.
- **W-5. Mark optionality explicitly.** If a field or practice is optional,
  prefix it with `OPTIONAL:`. If required, say nothing — required is the
  default. Never leave the reader guessing whether something is mandatory.
- **W-6. No motivational prose.** Skills are not blog posts. Do not explain
  WHY a convention exists unless the WHY changes how an agent applies the
  rule. "Atomic commits make bisection possible" adds nothing an agent can
  act on. "One logical change per commit" is the actionable rule.
- **W-7. Cross-reference, don't duplicate.** If another skill defines a
  schema this skill references, point to it: "See `handoff-schemas` for the
  `plan.json` schema." Do not copy the schema in. Duplication creates drift.
- **W-8. Version the skill.** Include a version line at the top:
  `<!-- version: 1.0.0 -->`. When agents cite a skill rule, they can
  reference the version. Bump on every meaningful edit.

---

## 4. Schema-defining skills

Skills that define data contracts (JSON schemas, file formats) are the most
critical skills in the pipeline. They are the single source of truth for
inter-agent communication.

- **SC-1.** Define schemas using a readable type notation, paired with a
  parallel JSON example for agents that consume raw JSON.
- **SC-2.** Mark every field as required or `OPTIONAL:`. Default values must
  be stated explicitly. Never leave field optionality ambiguous.
- **SC-3.** Include a COMPLETE, VALID example instance for every schema.
  The example must exercise every required field and at least one optional
  field. This is the agent's primary reference — most agents pattern-match on
  the example, not parse the schema.
- **SC-4.** Include a MINIMAL example instance showing only required fields.
  This is the "skeleton" agents use when constructing output.
- **SC-5.** Document CONSTRAINTS that can't be expressed in the type system:
  "`feature_id` must match an id in `feature-backlog.json`",
  "`depends_on` must not create cycles", "`estimated_loc` max 200".
- **SC-6.** For enum fields, list ALL valid values exhaustively.
  "`status: 'success' | 'partial' | 'error'`" — no "etc." or "others".

---

## 5. Convention skills

Skills that define conventions (commit format, comment style, branch naming)
must be unambiguous enough that two independent agents following the skill
produce output that looks like it came from the same author.

- **CV-1.** Define the format with a template string using placeholders:
  `{type}({scope}): {subject}` — not "include the type and scope".
- **CV-2.** List all valid values for constrained placeholders:
  `type: feat | fix | test | refactor | chore | docs | ci`.
- **CV-3.** Show 3–5 realistic examples spanning the range of valid outputs.
  Include short and long examples, simple and complex cases.
- **CV-4.** Show 2–3 INCORRECT examples each labeled with the specific rule
  it violates: "❌ `Fixed the bug` — missing type prefix (violates rule 1)".
- **CV-5.** If the convention has edge cases (multi-scope commits, breaking
  changes, co-authored commits), document them explicitly rather than
  leaving agents to guess.

---

## 6. Policy skills

Skills that define operational policies (context budgeting, resume protocol,
test strategy) encode DECISION CRITERIA — when to do X vs Y. They must
present clear decision trees, not vague guidance.

- **PO-1.** Present decisions as IF/THEN rules or decision tables:
  > IF `estimated_loc > 150` AND requires architectural judgment → opus.
  > IF `estimated_loc ≤ 50` AND mechanical transformation → haiku.
  > ELSE → sonnet.
- **PO-2.** Quantify thresholds. "Use Opus for complex tasks" is not a policy.
  "Use Opus when the task requires reading > 5 files and making cross-module
  decisions" is a policy.
- **PO-3.** For operational skills (resume, idempotency), include the
  CHECK-BEFORE-ACT pattern as a concrete code/command snippet:
  ```bash
  # Check before creating a PR
  existing=$(gh pr list --head "$branch" --json number -q '.[0].number')
  if [ -n "$existing" ]; then echo "PR #$existing exists"; exit 0; fi
  ```
- **PO-4.** Include a "What can go wrong" section for operational skills.
  List 2–3 failure modes and the correct recovery action for each.

---

## 7. Anti-patterns

### A-1. The Encyclopedia
A 6,000-token skill that exhaustively covers every edge case. It blows the
context budget and agents miss the important rules buried in the middle.
**FIX:** Compress to the 20% of rules that cover 80% of cases. Move edge
cases to `references/` agents can skip.

### A-2. The Blog Post
A skill written as a persuasive essay explaining WHY conventions matter.
"Clean commits are important because they enable git bisect, make code
review easier, and help future developers…" Agents don't need motivation;
they need rules.
**FIX:** Delete all motivational prose. Keep only rules + examples.

### A-3. The Suggestion Box
A skill full of hedged language: "Consider using…", "You might want to…",
"It's generally recommended to…". Agents treat suggestions as optional and
frequently skip them.
**FIX:** Direct imperatives. "Use X." "Never do Y."

### A-4. The Clone
Two skills that define overlapping concerns with slightly different rules.
`commit-atomicity` says "one change per commit" but `conventional-commits`
says "group related changes." Agents get conflicting instructions.
**FIX:** Cross-reference. One skill owns the rule, others point to it.

### A-5. The Schema Orphan
A skill references a JSON field (`task.context_pack`) but doesn't define it
or point to where it's defined. The agent encounters the field in real data
and guesses its shape.
**FIX:** Every field reference must resolve to a definition — either inline
or via cross-reference to another skill.

---

## 8. Authoring checklist (12-item gate)

Run before declaring a skill done. Every item is a hard gate.

1. Does the skill have a one-line `Purpose` that lets an agent decide
   relevance?
2. Are `Consumers` listed explicitly?
3. Are all rules numbered, imperative, and verifiable?
4. Is there at least one CORRECT example?
5. Is there at least one INCORRECT example with explanation?
6. Is the skill under 3,000 tokens (hard cap 5,000)?
7. Are all schema fields marked required or `OPTIONAL:`?
8. Are enum values listed exhaustively (no "etc.")?
9. Does every cross-reference point to a real skill name?
10. Is the skill versioned (`<!-- version: x.y.z -->`)?
11. Can two independent agents produce identical output by following this
    skill alone?
12. Is there zero motivational prose?

---

## 9. When NOT to write a skill

Do not author a skill if any of the following holds:

1. The knowledge is about WHAT or WHEN an agent acts (behavior). It belongs
   in the agent prompt under `.claude/agents/`, not in a skill.
2. An existing skill already covers the same `domain` + subdomain (check
   `INDEX.json`). Extend that skill instead.
3. The knowledge is a one-off project decision (architecture choice, chosen
   tech). Put it in `docs/ARCHITECTURE.md` or `docs/TECH_STACK.md`.
4. The knowledge is implementation detail of code the team owns. Put it in
   code or a code comment.

---

## 10. How to cite this reference

When a reviewer rejects a skill or a skill-author justifies a choice, cite
the rule by its ID and the version of this file:

> "Rejected: violates `skill-authoring/references/guidelines.md` v1.0.0
> rule **W-1** (Suggestion Box phrasing in rules 3 and 7) and **SC-2**
> (`task.skills` field optionality not marked)."

Citations are durable across edits because IDs do not get renumbered. New
rules get appended with the next available ID; obsolete rules are marked
`(deprecated)` rather than deleted.
