/**
 * auth.log-scrub.test.ts
 *
 * Adversarial smoke: verifies that no sensitive values (plaintext password,
 * session JWT, raw refresh cookie, CSRF token) appear in any captured log line
 * across the full login → refresh → me → logout flow.
 *
 * Strategy: build a pino logger wired to createLogCapture() and inject it as
 * the child logger for the auth service. After running the flow, call
 * capture.notContainsAny([...secrets]).
 *
 * Acceptance bullet 8.
 *
 * REQUIRES: Docker daemon running on the host.
 */
export {};
//# sourceMappingURL=auth.log-scrub.test.d.ts.map