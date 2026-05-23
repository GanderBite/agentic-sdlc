/**
 * dto.ts — auth module local mapping helpers
 *
 * Provides typed mapping functions that convert between internal service types
 * (`AuthTokens`) and the contract response shapes consumed by the routes layer.
 *
 * Nothing in this file touches the database or the network.
 */
import type { LoginResponse, RefreshResponse, MeResponse, LogoutResponse } from "@medbridge/contracts";

import type { AuthTokens } from "./service.js";

/**
 * Decodes the payload of a JWT (base64url middle segment) without signature
 * verification. Only used on JWTs we just issued ourselves — the purpose is to
 * read back the claims we embedded so we can populate the HTTP response body
 * without making a second DB call.
 *
 * Security note: this is NOT a verify operation. Never trust claims decoded
 * this way for authorization decisions.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  const payloadPart = parts[1];
  if (payloadPart === undefined) {
    throw new TypeError("Malformed JWT: missing payload segment");
  }
  const json = Buffer.from(payloadPart, "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Builds the `user` shape for a response from tokens we just issued.
 * Decodes claims from the `sessionJwt` payload (which we signed; no network
 * call needed). Throws if the payload is missing required fields.
 */
function userFromTokens(tokens: AuthTokens): LoginResponse["user"] {
  const payload = decodeJwtPayload(tokens.sessionJwt);

  const id = payload["sub"];
  const email = payload["email"];
  const role = payload["role"];

  if (typeof id !== "string" || typeof email !== "string" || typeof role !== "string") {
    throw new TypeError("JWT payload missing required claims (sub, email, role)");
  }

  if (role !== "patient" && role !== "doctor") {
    throw new TypeError(`Invalid role in JWT payload: ${role}`);
  }

  return { id, email, role };
}

/**
 * Builds the login response body from tokens returned by `service.login`.
 */
export function buildLoginResponse(tokens: AuthTokens): LoginResponse {
  return { user: userFromTokens(tokens) };
}

/**
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
  if (role !== "patient" && role !== "doctor") {
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
