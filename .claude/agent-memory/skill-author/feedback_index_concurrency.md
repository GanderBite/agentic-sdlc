---
name: INDEX.json races against parallel skill-author runs
description: Read-modify-write of INDEX.json fails repeatedly when multiple skill-author agents run concurrently. Loop with re-read.
type: feedback
---

When multiple skill-author invocations are in flight (e.g. the user is scaffolding a batch of skills via parallel sub-agents), `.claude/skills/INDEX.json` is rewritten between Read and Edit calls. The Edit tool then refuses with "File has been modified since read".

**Why:** The Edit tool stamps file mtime on read and verifies it before writing. Other agents writing in parallel invalidate the stamp. This is by design and protects against silent overwrites.

**How to apply:** Treat the INDEX.json update as a retry loop:

1. Read INDEX.json fresh.
2. Locate the *current* tail entry (it changes each retry).
3. Edit by appending after that tail.
4. If the Edit fails with the modified-since-read error, immediately Read again and retry the Edit. Do not sleep.
5. Be ready for new fields to appear on existing entries (e.g. `subdomain` was added to `drizzle` mid-session) — adapt your `old_string` accordingly.
