---
name: Test snippets needing absolute URLs trigger the http(s):// linter rule
description: When showing Fetch-API tests in SKILL.md, avoid bare http://localhost — use a helper variable like `abs(p)` with a non-http scheme such as 'app://test'
type: feedback
---

When authoring HTTP/test-related skills (hono, fastify, etc.) where examples need an absolute URL for `new Request(...)`, do NOT write `'http://localhost/...'` directly in SKILL.md.

**Why:** Linter rule §19.3 (`SKILL.md contains no http(s):// URLs`) is mechanical — it does not exempt loopback or example-only URLs. The Hono skill (2026-05-10) had to be edited twice to scrub `http://localhost` from test snippets.

**How to apply:**
- In SKILL.md test snippets, define a helper: `const abs = (p: string) => new URL(p, 'app://test').toString()` and use `abs('/path')`. Any non-http scheme works because Hono ignores the host.
- In `references/*.md` files, `http://localhost` is fine — the linter only scans SKILL.md.
- For curl examples, prefer pseudo-syntax like `curl ${HOST}/path` with HOST defined as an env var, never hardcoded `http://...`.
