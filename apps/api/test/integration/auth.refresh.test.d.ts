/**
 * Integration tests: auth.refresh
 *
 * REQUIRES: Docker daemon running on the host (testcontainers).
 *
 * Covers:
 *  - First call rotates: new refresh cookie differs from original; old hash row
 *    has revoked_at set; new active row exists.
 *  - Replaying the original refresh cookie after rotation returns 401.
 */
export {};
//# sourceMappingURL=auth.refresh.test.d.ts.map