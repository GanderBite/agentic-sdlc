---
name: feedback-log-scrub-test-pattern
description: Log-scrub tests that only exercise the test helper rather than wiring it into the production logger fail to verify the acceptance bullet they claim to cover.
metadata:
  type: feedback
---

When a test file named `*log-scrub*` (or similar) uses `createLogCapture()` but never injects the capture's `destination` into the app's pino instance, it is only testing the helper — not the production redact config. Flag as `high` security audit finding.

**Why:** Sprint-001 wave-10 shipped `apps/api/test/integration/auth.log-scrub.test.ts` whose own comments admit "we cannot directly capture pino output without wiring a custom destination at logger creation time." The test passed but acceptance bullet 8 (no PII in logs) is not exercised end-to-end. A regression that removed the production `redact` paths would still let this test pass.

**How to apply:** When reviewing any log-scrubbing test, grep for `pino(.+destination)` or whatever DI hook the app exposes (`buildApp(env, { logger })` or similar). If the test does not pass a custom `destination` into the real logger before issuing requests, downgrade the security guarantee from "verified" to "not verified" and emit a `high`/`security` finding. Related: [[project-env-eager-load]] — the same `buildApp` signature that blocks JWT_SECRET DI also blocks logger DI.
