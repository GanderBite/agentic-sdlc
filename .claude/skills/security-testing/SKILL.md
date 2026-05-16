<!-- version: 1.0.0 -->

# security-testing

## Purpose
Strategy for adversarial smoke tests on MedBridge's API: what authn/CSRF/RBAC/upload/argon2 negative paths to assert, how to assert them against the `AppError` taxonomy, and what NOT to test.

## Consumers
- `tester` builder persona (`.claude/agents/builder.md` when role=tester)
- `code-reviewer` (security-floor checks per brief §11)

## Scope and non-overlap

This skill encodes assertions and adversarial inputs. It does NOT cover:

- Container lifecycle, fixtures, schema reset — see `testcontainers` skill.
- Vitest runner config, `expect`, mocks — see `vitest` skill.
- HTTP request shape, route under test, base seed data — see `api-integration-testing` skill.
- Cryptographic correctness of `jose` or `argon2` themselves. Trust the library; assert only behavior under our wrappers.

## Rules

### Smoke matrix (required negatives)

1. Every authenticated route ships these authn negatives: missing JWT, expired JWT (`exp` < now), forged JWT (signed with attacker key), wrong-`kid` JWT (header `kid` not in JWKS). Each asserts status `401` and `AppError.code === "AUTH_INVALID_TOKEN"` (or `"AUTH_MISSING_TOKEN"` for the missing case).
2. Every state-changing route (POST/PATCH/PUT/DELETE) ships these CSRF negatives: missing `X-CSRF-Token` header, header value mismatching the `csrf` cookie, header present but cookie absent. Each asserts `403` + `AppError.code === "CSRF_INVALID"`.
3. Every RBAC-gated route ships a role-matrix smoke iterating `patient | doctor | admin`. The matrix asserts `403` + `AppError.code === "FORBIDDEN"` for every disallowed `(role, route)` pair and `2xx` for allowed pairs. Never skip rows.
4. Every document-share-protected route ships these authorization negatives: revoked share (`revoked_at IS NOT NULL`), expired share (`expires_at < now`), wrong-viewer share (`viewer_id !== sub`), share-for-different-document. Each asserts `403` + `AppError.code === "SHARE_INVALID"` and never `404` (do not leak existence; see Rule 10).
5. Every multipart upload route ships these negatives: MIME spoof (declared `image/png`, magic bytes `%PDF`), oversize body (≥ `MAX_UPLOAD_BYTES + 1`), path-traversal filename (`../../etc/passwd`, `..\\..\\windows\\system32`, embedded NUL `\x00`). Status codes: `415` for MIME mismatch, `413` for oversize, `400` for filename. Codes: `UPLOAD_MIME_MISMATCH`, `UPLOAD_TOO_LARGE`, `UPLOAD_BAD_FILENAME`.
6. The argon2 password-verify path ships a timing smoke: call verify 50× with a valid hash + wrong password, and 50× with an unknown-user fast-fail path. Assert the mean-time delta is within ±15% (see `references/argon2-timing.md` for the tolerance derivation and a ready-to-copy harness).

### Token minting for negatives

7. Mint malicious JWTs with `jose.SignJWT` using a *throwaway* keypair generated per test file. Never reuse the production signing key. See `references/token-minting.md` for the four canonical bad-token recipes.
8. Reproduce "expired" by setting `exp` to `Math.floor(Date.now()/1000) - 1`. Reproduce "forged" by signing with a key whose public half is NOT in the API's JWKS. Reproduce "wrong-kid" by signing with the real key but setting `header.kid` to `"unknown"`.

### Error-envelope assertions

9. Assert all three: HTTP status code, `body.error.code` (taxonomy enum), and `body.error.message` shape (non-empty string, length ≤ 200, contains no SQL fragments, no stack frames, no file paths). See `references/error-envelope.md` for the full assertion helper and the leak-detection regex set.
10. Never assert on `body.error.message` content equality. Assert on `code` for behavior and on `message` only for the leak-detection regex (Rule 9). Messages are user-facing and may be reworded.
11. For authorization failures on resources the caller cannot see, the API MUST return `403 SHARE_INVALID` / `403 FORBIDDEN`, not `404`. The test asserts `403`. Returning `404` to "hide existence" leaks existence via timing and is forbidden by the brief's security floor.

### CSRF double-submit invariants

12. Assert that the `csrf` cookie is set with `SameSite=Lax`, `HttpOnly=false` (the UI reads it), `Secure=true` in non-dev environments, and `Path=/`.
13. Assert that the `csrf` cookie value rotates after `/auth/refresh`: pre-refresh cookie value must NOT equal post-refresh cookie value, and the old value must fail double-submit on the next request.
14. Assert that GET/HEAD/OPTIONS requests are NOT rejected for missing CSRF. Only state-changing verbs are gated.

### RBAC matrix testing pattern

15. Define the role matrix as a single `describe.each` table keyed by `(role, route, expectedStatus)`. The table is the source of truth — adding a new role or route requires adding rows, not new tests. See `references/rbac-matrix.md` for the table shape.
16. Use a typed `MatrixRow` from `packages/contracts` if available; otherwise inline the row type in the test file. Never use untyped tuples.

### Upload safety

17. Detect MIME by magic bytes server-side; the test sends a file whose declared `Content-Type` and magic bytes disagree and asserts the magic-byte verdict wins (`415`).
18. Assert filename sanitization at the *output* boundary: after upload, fetch the stored object's filename via the API and assert it matches `^[A-Za-z0-9._-]{1,255}$` and contains no `/`, `\`, or `\x00`.
19. Oversize tests send `MAX_UPLOAD_BYTES + 1` bytes, not `MAX_UPLOAD_BYTES * 10`. The boundary case is what regresses.

### What NOT to test (negative scope)

20. Never test `jose` signature math, `argon2` hash output, or Node's `crypto.timingSafeEqual`. These are library invariants.
21. Never assert on log output for security events. Logs are observability, not contract.
22. Never use real production credentials, real JWKS, or real session cookies in a test. Per-test ephemeral keys only.

## Format — security-smoke test skeleton

```ts
// apps/api/src/modules/<module>/__tests__/<module>.security.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { mintExpiredJwt, mintForgedJwt, mintWrongKidJwt } from "@/test/security/tokens";
import { assertAppError } from "@/test/security/envelope";
import { app } from "@/app";

describe("<module> :: authn negatives", () => {
  it.each([
    ["missing",   undefined,                   401, "AUTH_MISSING_TOKEN"],
    ["expired",   () => mintExpiredJwt(),      401, "AUTH_INVALID_TOKEN"],
    ["forged",    () => mintForgedJwt(),       401, "AUTH_INVALID_TOKEN"],
    ["wrong-kid", () => mintWrongKidJwt(),     401, "AUTH_INVALID_TOKEN"],
  ])("rejects %s JWT", async (_label, mint, status, code) => {
    const headers: Record<string,string> = {};
    if (mint) headers.authorization = `Bearer ${await mint()}`;
    const res = await app.request("/api/<resource>", { method: "GET", headers });
    expect(res.status).toBe(status);
    await assertAppError(res, code);
  });
});
```

## Examples

### CORRECT — share-authorization negative for a doctor route

```ts
// apps/api/src/modules/documents/__tests__/share.security.test.ts
import { describe, it, expect } from "vitest";
import { seedShare } from "@/test/security/factories";
import { mintJwt } from "@/test/security/tokens";
import { assertAppError } from "@/test/security/envelope";
import { app } from "@/app";

describe("GET /api/documents/:id (shared)", () => {
  it.each([
    ["revoked",       { revoked_at:  new Date()  }],
    ["expired",       { expires_at: new Date(Date.now() - 1000) }],
    ["wrong-viewer",  { viewer_id:  "user_other" }],
  ])("returns 403 SHARE_INVALID when share is %s", async (_label, overrides) => {
    const { documentId, viewerId } = await seedShare({ viewer_id: "user_alice", ...overrides });
    const token = await mintJwt({ sub: "user_alice", role: "patient" });
    const res = await app.request(`/api/documents/${documentId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    await assertAppError(res, "SHARE_INVALID");
  });
});
```

### INCORRECT — leaks taxonomy, asserts on message, returns 404

```ts
it("rejects revoked share", async () => {
  const res = await app.request(`/api/documents/${id}`, { headers });
  expect(res.status).toBe(404);                          // violates Rule 11
  const body = await res.json();
  expect(body.error.message).toBe("Share not found.");   // violates Rule 10
  // no code assertion                                   // violates Rule 9
});
```

WHY this is wrong: Rule 11 (must be `403 SHARE_INVALID`, not `404` — `404` leaks existence by timing), Rule 10 (asserts message equality), Rule 9 (no `code` assertion, no leak-regex check on message).

### INCORRECT — hedged, no matrix, library-internal

```ts
it("should probably reject bad tokens", async () => {
  const res = await app.request("/api/me", { headers: { authorization: "Bearer x" } });
  expect(res.status).toBeGreaterThanOrEqual(400);   // not specific
});

it("argon2 hashes correctly", async () => {
  const h = await argon2.hash("pw");
  expect(await argon2.verify(h, "pw")).toBe(true);  // violates Rule 20 (tests library, not our wrapper)
});
```

WHY this is wrong: status assertion is non-specific (Rule 1 demands `401` exactly with a code); the second test exercises `argon2` itself, which is library scope (Rule 20). Only the *missing-JWT* row of the authn matrix is covered — the other three rows of Rule 1 are absent.

## Deeper reference

- `references/token-minting.md` — four canonical bad-JWT recipes (expired / forged / wrong-kid / wrong-alg), throwaway-keypair setup.
- `references/error-envelope.md` — `AppError` taxonomy table, `assertAppError` helper, leak-detection regex set.
- `references/rbac-matrix.md` — full `describe.each` matrix shape, role × route table, fixture wiring.
- `references/argon2-timing.md` — timing-attack smoke harness, tolerance derivation, why ±15%.
- `references/upload-vectors.md` — magic-byte table, path-traversal corpus, oversize-boundary fixture.
