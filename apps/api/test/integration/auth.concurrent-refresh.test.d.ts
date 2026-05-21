/**
 * auth.concurrent-refresh.test.ts
 *
 * Adversarial smoke: verifies that two concurrent POST /auth.refresh requests
 * carrying the same refresh cookie result in exactly one 200 (token rotated)
 * and one 401 (token already consumed), never two 200s.
 *
 * The atomicity guarantee comes from the UPDATE...WHERE revoked_at IS NULL
 * RETURNING statement in repo.rotateRefreshToken — only one UPDATE will win
 * the race even under concurrent execution.
 *
 * Acceptance bullet 11.
 *
 * REQUIRES: Docker daemon running on the host.
 */
export {};
//# sourceMappingURL=auth.concurrent-refresh.test.d.ts.map