/**
 * dto.ts — auth module local mapping helpers
 *
 * Provides typed mapping functions that convert between internal service types
 * (`AuthTokens`) and the contract response shapes consumed by the routes layer.
 *
 * Nothing in this file touches the database or the network.
 */
import type {
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RefreshResponse,
} from '@medbridge/contracts';

import type { AuthTokens, UserClaims } from './service.js';

/**
 * @deprecated F-205 — round-tripping through a base64-decoded JWT to read
 * back claims we just signed is wasteful and sets a dangerous precedent: future
 * code might copy "decode unverified JWT → trust claims" onto authorization
 * paths. Use `buildLoginResponseFromClaims` instead.
 *
 * TODO(sprint-003): remove once service.issueTokens returns UserClaims directly
 * alongside AuthTokens so callers never need to re-parse the JWT. (F-205)
 *
 * Security note: this is NOT a verify operation. Never trust claims decoded
 * this way for authorization decisions.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    throw new TypeError('Malformed JWT: missing payload segment');
  }
  const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * @deprecated F-205 — prefer `buildLoginResponseFromClaims(claims)` which
 * accepts the `UserClaims` object directly from the service, avoiding the
 * JWT round-trip entirely.
 *
 * TODO(sprint-003): remove once service.issueTokens returns UserClaims directly
 * alongside AuthTokens. (F-205)
 *
 * Builds the `user` shape for a response from tokens we just issued.
 * Decodes claims from the `sessionJwt` payload (which we signed; no network
 * call needed). Throws if the payload is missing required fields.
 */
function userFromTokens(tokens: AuthTokens): LoginResponse['user'] {
  const payload = decodeJwtPayload(tokens.sessionJwt);

  const id = payload['sub'];
  const email = payload['email'];
  const role = payload['role'];

  if (typeof id !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
    throw new TypeError('JWT payload missing required claims (sub, email, role)');
  }

  if (role !== 'patient' && role !== 'doctor') {
    throw new TypeError(`Invalid role in JWT payload: ${role}`);
  }

  return { id, email, role };
}

/**
 * Builds the login response body from claims already held by the service,
 * without decoding the signed JWT. This is the preferred builder — it avoids
 * the unsafe round-trip through `decodeJwtPayload`.
 *
 * Call this once `service.issueTokens` is updated to return `UserClaims`
 * alongside `AuthTokens` (sprint-003, F-205).
 */
export function buildLoginResponseFromClaims(claims: UserClaims): LoginResponse {
  return { user: { id: claims.userId, email: claims.email, role: claims.role } };
}

/**
 * Builds the refresh response body from claims already held by the service,
 * without decoding the signed JWT. This is the preferred builder — it avoids
 * the unsafe round-trip through `decodeJwtPayload`.
 *
 * Call this once `service.issueTokens` is updated to return `UserClaims`
 * alongside `AuthTokens` (sprint-003, F-205).
 */
export function buildRefreshResponseFromClaims(claims: UserClaims): RefreshResponse {
  return { user: { id: claims.userId, email: claims.email, role: claims.role } };
}

/**
 * @deprecated F-205 — use `buildLoginResponseFromClaims(claims)` instead.
 * Builds the login response body from tokens returned by `service.login`.
 */
export function buildLoginResponse(tokens: AuthTokens): LoginResponse {
  return { user: userFromTokens(tokens) };
}

/**
 * @deprecated F-205 — use `buildRefreshResponseFromClaims(claims)` instead.
 * Builds the refresh response body from tokens returned by `service.refresh`.
 */
export function buildRefreshResponse(tokens: AuthTokens): RefreshResponse {
  return { user: userFromTokens(tokens) };
}

/**
 * Builds the me response body from the user set on context by the authn
 * middleware. The authn middleware stores `{ id, email, role }` (not `userId`).
 */
export function buildMeResponse(user: {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}): MeResponse {
  const role = user.role;
  if (role !== 'patient' && role !== 'doctor') {
    throw new TypeError(`Invalid role from authn context: ${role}`);
  }
  return { user: { id: user.id, email: user.email, role } };
}

/**
 * Builds the logout response body.
 */
export function buildLogoutResponse(): LogoutResponse {
  return { ok: true };
}
