---
name: skill-linter token count heuristic
description: skill-linter.mjs counts tokens as Math.ceil(chars/4) — not a real tokenizer
type: reference
---

`scripts/skill-linter.mjs` line 77: `const tokenCount = (text) => Math.ceil(text.length / 4)`. Comment notes this matches the §15.2 heuristic.

**How to apply:**
- Aim for ≤12,000 chars (≈3,000 tokens) in `SKILL.md` to comfortably hit the target.
- Hard cap: 20,000 chars (≈5,000 tokens).
- Use `wc -c <path>` to measure quickly.
- The `size_tokens` field in INDEX.json should match this heuristic, not a real tokenizer count.
