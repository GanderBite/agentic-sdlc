/**
 * auth.token-family.test.ts
 *
 * Adversarial smoke: verifies token-family revocation on refresh-token replay.
 *
 * Flow:
 *   1. Login → capture refresh cookie R1.
 *   2. Refresh with R1 → rotates to R2.
 *   3. Replay R1 (now revoked).
 *   4. Assert:
 *      a. Response is 401.
 *      b. SELECT ... WHERE user_id = ? AND revoked_at IS NULL returns 0 rows
 *         (all tokens in the family are revoked).
 *      c. Captured log has exactly one warn line containing the userId.
 *
 * Acceptance bullet 12.
 *
 * REQUIRES: Docker daemon running on the host.
 */
export {};
//# sourceMappingURL=auth.token-family.test.d.ts.map