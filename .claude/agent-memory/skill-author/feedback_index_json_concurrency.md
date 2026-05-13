---
name: INDEX.json concurrent-write hazard
description: Multiple skill-author invocations may run in parallel and append to .claude/skills/INDEX.json between your Read and Edit calls
type: feedback
---

When authoring a skill, do NOT trust the INDEX.json contents you read in step 1 of the procedure. Re-read it immediately before the Edit call that appends the new entry.

**Why:** During an auto-mode multi-skill scaffold session, several skill-author agents ran in parallel. INDEX.json grew from 7 to 10 entries between my initial Read and my Edit, and Edit failed with "File has been modified since read". Re-reading and re-applying succeeded. The system-reminder skill list growing mid-conversation (new skills appearing) is the visible signal that parallel work is happening.

**How to apply:**
- After the initial duplicate-check Read, do all your authoring work (write SKILL.md, references).
- Just before the Edit on INDEX.json, Read it again. Re-check `domain` + optional `subdomain` uniqueness against the latest contents. Append after the new last entry, not the entry you remembered.
- If Edit fails with "modified since read", do not retry blindly — Read again and rebuild the old_string from the new tail entry.
- The skill-linter reports `skill_not_in_index` for sibling skills authored by parallel runs. Those errors are not yours to fix; just confirm `typescript` (or your skill name) is no longer in the linter output.
