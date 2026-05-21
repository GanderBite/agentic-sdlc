// Importing `env` exercises the JWT_SECRET fail-fast check (loadEnv) on first
// import of this module — undersized or missing JWT_SECRET throws before any
// export is reachable.
import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { env } from '../../shared/env.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Encode the secret string as a Uint8Array key for jose. */
function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Session token (short-lived JWT, HS256)
// ---------------------------------------------------------------------------

export interface SessionClaims {
  readonly userId: string;
  readonly role: string;
}

/**
 * Sign a 15-minute (or caller-specified) session JWT with HS256.
 * Custom claims `userId` and `role` are embedded in the payload.
 */
export async function createSessionToken(
  claims: SessionClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId: claims.userId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(secretKey(secret));
}

// ---------------------------------------------------------------------------
// Session token verification
// ---------------------------------------------------------------------------

/** Narrow the unknown jwt payload to the required session-claims shape. */
function assertSessionClaims(payload: unknown): SessionClaims {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).userId !== 'string' ||
    typeof (payload as Record<string, unknown>).role !== 'string'
  ) {
    const err = new Error('JWT payload missing required claims: userId, role');
    err.name = 'InvalidTokenClaimsError';
    throw err;
  }
  const p = payload as Record<string, unknown>;
  return {
    userId: p.userId as string,
    role: p.role as string,
  };
}

/**
 * Verify a session JWT signed with HS256 and return the `userId` and `role`
 * claims.  Throws `InvalidTokenClaimsError` when the shape is wrong, or a
 * jose error (`JWTExpired`, `JWSSignatureVerificationFailed`, …) on
 * cryptographic failure — the caller (authRequired middleware) should wrap
 * both as UnauthorizedError.
 */
export async function verifySessionToken(jwt: string, secret: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(jwt, secretKey(secret), {
    algorithms: ['HS256'],
  });
  return assertSessionClaims(payload);
}

// ---------------------------------------------------------------------------
// Refresh token helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random refresh-token value.
 * Encoded as base64url (URL-safe, no padding) for safe cookie transport.
 */
export function createRefreshTokenValue(): string {
  // base64url: URL-safe alphabet, no `=` padding — safe for Set-Cookie values.
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a raw refresh-token value with SHA-256 for storage.
 * Refresh tokens are revoked-on-use server-side, so a fast hash is
 * appropriate here (no need for a slow KDF like argon2).
 * Returns a lowercase hex string.
 */
export async function hashRefreshToken(raw: string): Promise<string> {
  return createHash('sha256').update(raw).digest('hex');
}

// Re-export env reference so that the fail-fast side-effect is guaranteed even
// when tree-shaking would otherwise elide the `import` above.
export { env as _env };
