---
name: $schema fields and other auto-emitted URLs trip §19.3
description: When showing config-file examples (components.json, tsconfig, biome.json, package.json), the `$schema` field commonly contains an https URL — the skill-linter forbids any http(s):// URL in SKILL.md regardless of context (string literal, code fence, comment).
type: feedback
---

When showing config-file examples (`components.json`, `tsconfig.json`, `biome.json`, `package.json`, etc.), authors instinctively include the real `$schema` URL the tool would write. The linter regex `/https?:\/\//i` matches inside fenced code blocks, JSON string literals, and comments — there is no escape.

**Why:** Caught on the shadcn-ui skill — wrote `"$schema": "https://ui.shadcn.com/schema.json"` inside a `components.json` example. Linter flagged immediately. The rule (§19.3) is unconditional.

**How to apply:**

- For any `$schema` field in a config example, replace the URL with a placeholder like `"<schema-url>"`, `"<tool-schema-url>"`, or `"<n>-schema-url"` and add a comment that the CLI/tool writes the real value.
- Same rule applies to `repository.url`, `bugs.url`, `homepage`, `funding.url` in `package.json` examples.
- Same rule applies to badge URLs and any link in a markdown example block.
- When a real URL is genuinely load-bearing (registry endpoint, doc deeplink), put it in a `references/*.md` file and link to that file by relative path from SKILL.md.
- Always grep your SKILL.md for `https?://` before declaring done: `node -e "const t=require('fs').readFileSync(p,'utf8'); console.log((t.match(/https?:\/\//gi)||[]).length)"`.
