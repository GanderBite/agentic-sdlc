---
name: sprint002-harness-spy-indirection
description: Wave-9 shipped test/support/passwords.ts + logCapture.ts that wrap argon2 and pino without actually intercepting production code — vi.spyOn against the harness modules is a no-op against the auth service.
metadata:
  type: project
---

In sprint-002 wave-9 the integration-test harness (`apps/api/test/support/`) shipped:
- `passwords.ts` that calls `argon2.verify` directly — same path as `apps/api/src/shared/password.ts` — so spying on `passwords` exports never intercepts the auth service's verify calls.
- `logCapture.ts` that builds a pino destination stream and a separate `buildCapturingLogger`, but never swaps the production `apps/api/src/shared/logger.ts` instance — so capturing logs from prod code requires stdout capture, not this helper.

**Why:** Test harnesses must either re-export the production module (so spies bind to the same import) or document a setup hook that swaps the singleton. Wrapping a library directly creates a parallel surface that looks correct but does nothing in tests.

**How to apply:** When reviewing future integration-test harness PRs, verify that any "spy-able" or "capturable" helper actually shares the import path with the production code under test, or supplies a configure-once setup hook. Acceptance bullets B7 (argon2 spy) and B14 (log capture) of `api-scaffold-auth.enriched.md` depend on this and are currently unverifiable through the wave-9 harness.
