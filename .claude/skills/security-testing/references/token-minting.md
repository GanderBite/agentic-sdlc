# Token minting for security smokes

Four canonical bad-JWT recipes. All use `jose ^5.9.x`. All keys are generated per test file and never persisted.

## Setup — throwaway keypair

```ts
// apps/api/src/test/security/tokens.ts
import { SignJWT, exportJWK, generateKeyPair } from "jose";

// The API's *real* signing key is loaded from KMS in app.ts. For tests, the
// test harness boots app.ts with an injected dev keypair (kid="test-1") and
// publishes its public half to a fake JWKS endpoint. Bad-token tests then
// sign with EITHER that key (for "expired" / "wrong-kid") OR a fresh
// attacker key (for "forged").

const ALG = "EdDSA";

export const realKeys = await generateKeyPair(ALG, { extractable: true });
export const realKid  = "test-1";
export const attackerKeys = await generateKeyPair(ALG, { extractable: true });

export async function publishJwks() {
  const jwk = await exportJWK(realKeys.publicKey);
  return { keys: [{ ...jwk, kid: realKid, alg: ALG, use: "sig" }] };
}
```

The harness wires `publishJwks()` into a test-only `/.well-known/jwks.json` route; the JWT middleware fetches that URL in test mode.

## Recipe 1 — valid baseline (sanity)

```ts
export function mintJwt(claims: { sub: string; role: "patient" | "doctor" | "admin" }) {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: ALG, kid: realKid })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer("medbridge-api")
    .setAudience("medbridge-ui")
    .setExpirationTime("15m")
    .sign(realKeys.privateKey);
}
```

## Recipe 2 — expired

```ts
export function mintExpiredJwt(sub = "user_alice") {
  return new SignJWT({ role: "patient" })
    .setProtectedHeader({ alg: ALG, kid: realKid })
    .setSubject(sub)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // 1h ago
    .setIssuer("medbridge-api")
    .setAudience("medbridge-ui")
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1) // expired 1s ago
    .sign(realKeys.privateKey);
}
```

## Recipe 3 — forged (attacker key)

```ts
export function mintForgedJwt(sub = "user_alice") {
  return new SignJWT({ role: "admin" }) // attacker tries privilege escalation
    .setProtectedHeader({ alg: ALG, kid: realKid }) // claims our kid
    .setSubject(sub)
    .setIssuedAt()
    .setIssuer("medbridge-api")
    .setAudience("medbridge-ui")
    .setExpirationTime("15m")
    .sign(attackerKeys.privateKey); // but signs with attacker key
}
```

The middleware MUST reject because the JWKS-published public key for `kid=test-1` does not verify the attacker's signature.

## Recipe 4 — wrong kid

```ts
export function mintWrongKidJwt(sub = "user_alice") {
  return new SignJWT({ role: "patient" })
    .setProtectedHeader({ alg: ALG, kid: "unknown" })
    .setSubject(sub)
    .setIssuedAt()
    .setIssuer("medbridge-api")
    .setAudience("medbridge-ui")
    .setExpirationTime("15m")
    .sign(realKeys.privateKey);
}
```

The middleware MUST reject during key resolution before signature verification (no JWK matches `kid=unknown`).

## OPTIONAL — wrong-alg

`jose` v5 already rejects `none`. A targeted test confirms our middleware passes the explicit `algorithms: [ALG]` allowlist to `jwtVerify`. If you suspect drift:

```ts
export function mintWrongAlgJwt() {
  // Sign with HS256 while the verifier expects EdDSA.
  // The shared-secret value here is arbitrary; verification fails on alg-mismatch
  // before any secret comparison.
  return new SignJWT({ role: "patient" })
    .setProtectedHeader({ alg: "HS256", kid: realKid })
    .setSubject("user_alice")
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode("does-not-matter"));
}
```

## Anti-patterns

- Reusing the real production signing key in tests. Even for "valid baseline" tests, mint with a test-only key pair.
- Storing minted JWTs as fixtures on disk. They expire and rot. Mint fresh per `describe` block.
- Signing with `none`. `jose` v5 refuses; do not waste a test row on it.
