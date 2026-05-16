import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';

import { loadEnv } from '../../shared/env.js';

// Fail-fast: if JWT_SECRET is missing or shorter than 32 bytes, loadEnv throws
// before any of the exports below are reachable.
const _env = loadEnv();
void _env;

// ---------------------------------------------------------------------------
// Internal payload schema
// ---------------------------------------------------------------------------

const sessionPayloadSchema = z.object({
  userId: z.string(),
  role: z.string(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

// ---------------------------------------------------------------------------
// Access-token helpers
// ---------------------------------------------------------------------------

/**
 * Signs a short-lived HS256 JWT carrying `userId` and `role`.
 *
 * @param payload  - Claims to embed in the JWT.
 * @param secret   - The raw secret string; encoded with TextEncoder internally.
 * @param ttlSeconds - Token lifetime in seconds (e.g. 900 for 15 min).
 * @returns        Compact JWT string.
 */
export async function createSessionToken(
  payload: SessionPayload,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ userId: payload.userId, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/**
 * Verifies an HS256 JWT and extracts the session claims.
 *
 * Throws if the token is expired, has an invalid signature, or does not
 * carry the expected `userId` / `role` payload fields.
 *
 * @param token  - Compact JWT string.
 * @param secret - The raw secret string used when signing.
 * @returns      Verified `{ userId, role }` claims.
 */
export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });

  const parsed = sessionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('JWT payload shape invalid');
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Refresh-token helpers
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random 32-byte refresh token value
 * encoded as base64url.
 *
 * @returns 43-character base64url string (256 bits of entropy).
 */
export function createRefreshTokenValue(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Produces a SHA-256 hex digest of the raw refresh token.
 *
 * Refresh tokens are revoked-on-use server-side, so SHA-256 is
 * appropriate — the stored hash is never used to derive secrets.
 *
 * @param raw - The plaintext refresh token value.
 * @returns   64-character lowercase hex string.
 */
export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
