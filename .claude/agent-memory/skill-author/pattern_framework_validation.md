---
name: Framework-validation skill structure
description: Recurring SKILL.md structure for runtime validation libraries (zod-style) in TS monorepos
type: project
---

For runtime-validation libraries (zod and any future analogues like ArkType, Valibot), the canonical SKILL.md skeleton is:

```
1. Schema authoring rules (naming, optionality, strict mode, discriminated unions)
2. Type inference + sharing rules (z.infer, packages/shared layout, workspace:*)
3. Composition rules (extend / pick / omit / merge / partial)
4. Refinement & transform rules
5. Coercion rules (forbid on JSON bodies, allow on query/params)
6. HTTP framework integration (validator middleware, hook contract)
7. Error envelope (canonical 400 shape, never leak raw library errors)
```

**Why:** All HTTP-validation libraries face the same axes — the only thing that varies is API surface. This pattern keeps the rules section dense and avoids prose.

**How to apply:**
- Default reference files: `coerce-pitfalls.md` (or equivalent gotchas), `error-envelope.md` (HTTP wire shape), `composition-patterns.md` (entity/DTO/sharing).
- Always include CORRECT + INCORRECT examples for: parse-vs-safeParse misuse, coercion misuse, entity/DTO field duplication.
- Always pin the major version in the skill description (e.g., "Zod v4") — major versions reshape the API.
