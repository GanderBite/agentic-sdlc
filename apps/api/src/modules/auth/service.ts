import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";

import type { Db, Tx } from "../../shared/db.js";
import { UnauthorizedError } from "../../shared/errors.js";
import { user as userTable } from "../accounts/schema.js";
import {
  findUserByEmail,
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeRefreshToken,
} from "./repo.js";
import type { LoginThrottle } from "./throttle.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserClaims = {
  readonly userId: string;
  readonly email: string;
  readonly role: "patient" | "doctor";
};

export type AuthTokens = {
  /** Signed JWT string for the session cookie. */
  readonly sessionJwt: string;
  /** Raw refresh token value for the refresh cookie. */
  readonly refreshTokenValue: string;
  /** CSRF cookie value (double-submit). */
  readonly csrfToken: string;
};

export type Logger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

export type AuthServiceDeps = {
  readonly db: Db;
  readonly throttle: LoginThrottle;
  /**
   * Verify a plaintext password against a stored hash.
   * Must be called exactly once per login attempt even if the user does not
   * exist (constant-time property: B7/B13).
   */
  readonly verifyPassword: (storedHash: string, plaintext: string) => Promise<boolean>;
  /**
   * Sign a short-lived session JWT containing the provided claims.
   */
  readonly signSessionJwt: (claims: UserClaims) => Promise<string>;
  /**
   * Hash a raw refresh token value into the stored token_hash.
   */
  readonly hashRefreshToken: (rawToken: string) => string;
  /**
   * Returns current wall-clock time.
   */
  readonly now: () => Date;
  /**
   * Request-scoped structured logger (attached to ctx by the logger middleware).
   */
  readonly log: Logger;
};

export type LoginInput = {
  readonly ip: string;
  readonly email: string;
  readonly password: string;
};

export type RefreshInput = {
  /** The raw refresh token value read from the cookie. */
  readonly rawToken: string;
  /** Request-id for structured logging context. */
  readonly requestId: string;
};

export type LogoutInput = {
  /** The raw refresh token value read from the cookie. */
  readonly rawToken: string;
};

export type AuthService = {
  login(input: LoginInput): Promise<AuthTokens>;
  logout(input: LogoutInput): Promise<void>;
  refresh(input: RefreshInput): Promise<AuthTokens>;
  me(user: UserClaims): UserClaims;
};

// ---------------------------------------------------------------------------
// Constant-time dummy hash for missing-user path (B7)
// ---------------------------------------------------------------------------

/**
 * A known argon2id hash string used when the user does not exist.
 * We call verifyPassword against this so login takes the same time regardless
 * of whether the email exists in the database (B7 — constant-time).
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$dW5rbm93bi11c2VyLXBhZGRpbmc$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Fetch a user row by id within a transaction or db connection.
 * Used internally in the refresh flow where we already know the userId.
 */
async function findUserById(
  dbOrTx: Db | Tx,
  userId: string,
): Promise<typeof userTable.$inferSelect | undefined> {
  const rows = await dbOrTx
    .select()
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the auth service.  All external I/O dependencies are injected via
 * the `deps` argument (B13 — injectable deps for deterministic testing).
 */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { db, throttle, verifyPassword, signSessionJwt, hashRefreshToken, now, log } = deps;

  // -------------------------------------------------------------------------
  // Internal: build and persist a fresh token bundle
  // -------------------------------------------------------------------------
  async function issueTokens(
    dbOrTx: Db | Tx,
    userRow: { id: string; email: string; role: "patient" | "doctor" },
    rawRefreshToken: string,
    csrfToken: string,
  ): Promise<AuthTokens> {
    const claims: UserClaims = {
      userId: userRow.id,
      email: userRow.email,
      role: userRow.role,
    };

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await insertRefreshToken(dbOrTx, {
      userId: userRow.id,
      tokenHash,
      expiresAt,
    });

    const sessionJwt = await signSessionJwt(claims);

    return { sessionJwt, refreshTokenValue: rawRefreshToken, csrfToken };
  }

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------
  async function login(input: LoginInput): Promise<AuthTokens> {
    const { ip, email, password } = input;

    // B3: rate-limit check — throws TooManyRequestsError on 11th+ attempt
    throttle.check({ ip, email });

    // Attempt to load the user row (includes password_hash inline on user)
    const userRow = await findUserByEmail(db, email);

    // B7: always call verifyPassword exactly once — use dummy hash when the
    // user does not exist so timing is constant regardless of email existence.
    const hashToVerify = userRow !== undefined ? userRow.passwordHash : DUMMY_HASH;
    const passwordOk = await verifyPassword(hashToVerify, password);

    if (userRow === undefined || !passwordOk) {
      throw new UnauthorizedError("Invalid email or password");
    }

    const rawRefreshToken = generateSecureToken();
    const csrfToken = generateSecureToken();

    return issueTokens(db, userRow, rawRefreshToken, csrfToken);
  }

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------
  async function logout(input: LogoutInput): Promise<void> {
    const { rawToken } = input;
    const tokenHash = hashRefreshToken(rawToken);
    const tokenRow = await findRefreshTokenByHash(db, tokenHash);

    // Nothing to revoke: silently succeed (idempotent)
    if (tokenRow === undefined || tokenRow.revokedAt !== null) {
      return;
    }

    await revokeRefreshToken(db, tokenRow.id, now());
  }

  // -------------------------------------------------------------------------
  // refresh — single-use, scoped-to-hash rotation (B4)
  // -------------------------------------------------------------------------
  async function refresh(input: RefreshInput): Promise<AuthTokens> {
    const { rawToken, requestId } = input;
    const tokenHash = hashRefreshToken(rawToken);

    // The entire revoke + insert must be atomic to prevent two concurrent
    // refreshes both succeeding (the update-where-not-revoked guard in
    // revokeRefreshToken means only one concurrent caller can update the row;
    // the losing request will re-read the row and find it already revoked).
    return db.transaction(async (tx: Tx) => {
      const tokenRow = await findRefreshTokenByHash(tx, tokenHash);

      if (tokenRow === undefined) {
        // Fabricated or already-deleted token — treat as replay
        log.warn({ requestId }, "refresh_token replay detected");
        throw new UnauthorizedError("Invalid or expired refresh token");
      }

      if (tokenRow.revokedAt !== null) {
        // Row exists but was already revoked: replay attack on this specific hash.
        // The revoked_at is already set; we only warn and reject.
        log.warn({ userId: tokenRow.userId, requestId }, "refresh_token replay detected");
        throw new UnauthorizedError("Invalid or expired refresh token");
      }

      // Check wall-clock expiry
      if (tokenRow.expiresAt < now()) {
        // Revoke the expired token and reject
        await revokeRefreshToken(tx, tokenRow.id, now());
        throw new UnauthorizedError("Refresh token has expired");
      }

      // Revoke THIS row (update-where-not-revoked guard: no-op if the row was
      // concurrently revoked between the select and this update — the other
      // session's re-read will then fall into the revokedAt !== null branch above).
      await revokeRefreshToken(tx, tokenRow.id, now());

      // Resolve user record to build fresh JWT claims
      const userRow = await findUserById(tx, tokenRow.userId);

      if (userRow === undefined || userRow.deletedAt !== null) {
        throw new UnauthorizedError("User account is no longer active");
      }

      // Issue NEW refresh token + session JWT + CSRF token in the same tx
      const newRawToken = generateSecureToken();
      const newCsrfToken = generateSecureToken();

      return issueTokens(tx, userRow, newRawToken, newCsrfToken);
    });
  }

  // -------------------------------------------------------------------------
  // me
  // -------------------------------------------------------------------------
  function me(user: UserClaims): UserClaims {
    return user;
  }

  return { login, logout, refresh, me };
}
