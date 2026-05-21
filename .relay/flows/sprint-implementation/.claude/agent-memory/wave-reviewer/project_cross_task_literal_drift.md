---
name: cross-task-literal-drift
description: When two parallel tasks in a wave each need the same domain literal (password, email, secret), builders frequently invent diverging values unless the planner names the canonical source.
metadata:
  type: project
---

In sprint-001 wave-6 the planner described `apps/api/test/support/passwords.ts` as "re-export the seeded plaintext literal so tests don't duplicate it" — explicitly naming the seed script as the canonical source. The builder for task-test-support still wrote a brand-new literal (`'Test1234!@#$'`) rather than `'CorrectHorseBatteryStaple1!'` from the seed. The wave's three builders ran in parallel and never saw each other's files; only the reviewer can catch the divergence.

**Why:** Parallel-builder fanout assumes each task is self-contained. Cross-task semantic coherence is a reviewer responsibility, not a builder one. The planner's prose hint ("re-export the seeded literal") was ignored because the builder had no `import` line to follow — it could only see `target_files.create: ['apps/api/test/support/passwords.ts']` and zero `references` to the seed file.

**How to apply:** Whenever the wave contains two or more tasks whose target_files include the same kind of contextual literal (password, secret, email address, magic token, dev URL), explicitly run a cross-file grep for both occurrences during Phase 2 and emit a `blocking`/`duplication` finding (auto_fixable: true — literal swap) when they diverge. Treat this as a hard checklist item for any wave whose tasks share a domain noun. Cross-link to [[project_branded_id_divergence]] — same class of "parallel builders re-invented an existing definition".
