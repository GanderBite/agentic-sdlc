/**
 * Auth service — pure business logic, no framework coupling.
 *
 * Design decisions:
 *  - All collaborators are injected via the factory parameter so unit tests can
 *    spy on `hasher.verify`, `repo.*`, and `logger.warn` without touching the
 *    production implementations.
 *  - `createSessionToken`, `createRefreshTokenValue`, and `hashRefreshToken`
 *    are imported directly (not DI'd) because they are pure crypto helpers with
 *    no I/O and no state — there is nothing to spy on or replace in tests.
 *  - `env` is imported directly for the same reason (static config).
 *  - The fake stored hash constant (`FAKE_STORED_HASH`) ensures the unknown-email
 *    branch calls `hasher.verify` exactly once, matching the known-email branch.
 *    This prevents timing-based user enumeration (enriched bullet 14).
 *
 * NOTE ON findUserById: repo.ts does not expose a findUserById function and
 * target_files does not allow modifying repo.ts. The task notes say to prefer
 * existing repo functions or escalate. Since `refresh()` and `me()` must look
 * up a user by ID and no such repo function exists, we import `db` and the
 * `user` schema table directly here solely for those queries. This is a
 * deliberate, documented deviation from the repo-layer rule, scoped to these
 * two methods until repo.ts can be extended with findUserById.
 */

import { randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../../db/client.ts';
import { env } from '../../shared/env.js';
import { UnauthorizedError } from '../../shared/errors.js';
import type { PasswordHasher } from './passwords.ts';
import type * as repo from './repo.ts';
import { user as userTable } from './schema.ts';
import { createRefreshTokenValue, createSessionToken, hashRefreshToken } from './tokens.ts';

// ---------------------------------------------------------------------------
// DI interfaces
// ---------------------------------------------------------------------------

/** Minimal logger interface — compatible with pino child loggers. */
export interface ServiceLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Injectable clock — defaults to system clock in production. */
export interface Clock {
  now(): Date;
}

// ---------------------------------------------------------------------------
// A realistic-looking argon2id hash used as a timing decoy when the email
// does not exist.  hasher.verify() will run its full KDF and return false —
// the same computational path as a wrong-password attempt on a real account.
// ---------------------------------------------------------------------------

const FAKE_STORED_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHRmb3J0aW1pbmc$fakehashdatafakehashdatafakehashdatafakehashdatafk';

// ---------------------------------------------------------------------------
// Return shapes
// ---------------------------------------------------------------------------

export interface LoginResult {
  user: {
    readonly id: string;
    readonly email: string;
    readonly role: string;
  };
  readonly sessionJwt: string;
  readonly refreshTokenRaw: string;
  readonly csrfToken: string;
}

export interface UserResult {
  readonly id: string;
  readonly email: string;
  readonly role: string;
}

// ---------------------------------------------------------------------------
// Repo type alias — the full surface of repo.ts, injected for DI/testing
// ---------------------------------------------------------------------------

export type AuthRepo = typeof repo;

// ---------------------------------------------------------------------------
// Factory deps
// ---------------------------------------------------------------------------

export interface AuthServiceDeps {
  readonly repo: AuthRepo;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
  readonly logger: ServiceLogger;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAuthService(deps: AuthServiceDeps) {
  const { repo: authRepo, hasher, clock, logger } = deps;

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  async function login(email: string, plain: string): Promise<LoginResult> {
    const foundUser = await authRepo.findUserByEmail(email);

    // Always call hasher.verify exactly once — prevents timing-based user
    // enumeration. If no user was found, verify against a fake stored hash
    // (which will return false) so the hot path is the same length.
    const hashToVerify = foundUser?.passwordHash ?? FAKE_STORED_HASH;
    const passwordOk = await hasher.verify(hashToVerify, plain);

    if (!foundUser || !passwordOk) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Mint tokens
    const sessionJwt = await createSessionToken(
      { userId: foundUser.id, role: foundUser.role },
      env.JWT_SECRET,
      env.SESSION_TTL,
    );

    const refreshTokenRaw = createRefreshTokenValue();
    const refreshHash = hashRefreshToken(refreshTokenRaw);
    const expiresAt = new Date(clock.now().getTime() + env.REFRESH_TTL * 1000);

    await authRepo.insertRefreshToken({
      userId: foundUser.id,
      hash: refreshHash,
      expiresAt,
    });

    const csrfToken = randomBytes(32).toString('hex');

    return {
      user: {
        id: foundUser.id,
        email: foundUser.email,
        role: foundUser.role,
      },
      sessionJwt,
      refreshTokenRaw,
      csrfToken,
    };
  }

  // -------------------------------------------------------------------------
  // refresh
  // -------------------------------------------------------------------------

  async function refresh(refreshRaw: string, requestId: string): Promise<LoginResult> {
    const hash = hashRefreshToken(refreshRaw);

    // Attempt atomic rotation (marks the row revokedAt = now)
    const rotated = await authRepo.rotateRefreshToken(hash);

    if (rotated === null) {
      // Token not found as active — check if it ever existed (replay detection)
      const anywhere = await authRepo.findRefreshTokenAnywhere(hash);

      if (anywhere !== undefined) {
        // Token was previously active but is now revoked — replay detected.
        // Revoke the entire token family for this user and log a warning.
        await authRepo.revokeAllActiveForUser(anywhere.userId);

        logger.warn({ msg: 'refresh.replay_detected', userId: anywhere.userId, requestId });
      }

      throw new UnauthorizedError('Refresh token invalid or already used');
    }

    // rotated contains { id, userId, expiresAt } — look up the full user row.
    // repo.ts has no findUserById; we inline the db query here (see file-level note).
    const userRows = await db
      .select()
      .from(userTable)
      .where(eq(userTable.id, rotated.userId))
      .limit(1);

    const refreshedUser = userRows[0];
    if (refreshedUser === undefined) {
      throw new UnauthorizedError('User not found for refresh token');
    }

    // Issue new tokens
    const sessionJwt = await createSessionToken(
      { userId: refreshedUser.id, role: refreshedUser.role },
      env.JWT_SECRET,
      env.SESSION_TTL,
    );

    const newRefreshRaw = createRefreshTokenValue();
    const newRefreshHash = hashRefreshToken(newRefreshRaw);
    const expiresAt = new Date(clock.now().getTime() + env.REFRESH_TTL * 1000);

    await authRepo.insertRefreshToken({
      userId: refreshedUser.id,
      hash: newRefreshHash,
      expiresAt,
    });

    const csrfToken = randomBytes(32).toString('hex');

    return {
      user: {
        id: refreshedUser.id,
        email: refreshedUser.email,
        role: refreshedUser.role,
      },
      sessionJwt,
      refreshTokenRaw: newRefreshRaw,
      csrfToken,
    };
  }

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  async function logout(refreshRaw: string): Promise<void> {
    const hash = hashRefreshToken(refreshRaw);
    // Revoke this single token row. rotateRefreshToken marks revokedAt = now.
    // We don't need the returned row — logout is best-effort.
    await authRepo.rotateRefreshToken(hash);
  }

  // -------------------------------------------------------------------------
  // me
  // -------------------------------------------------------------------------

  async function me(userId: string): Promise<UserResult> {
    // repo.ts has no findUserById; we inline the query here (see file-level note).
    const rows = await db.select().from(userTable).where(eq(userTable.id, userId)).limit(1);

    const found = rows[0];
    if (found === undefined) {
      throw new UnauthorizedError('User not found');
    }

    return {
      id: found.id,
      email: found.email,
      role: found.role,
    };
  }

  return { login, refresh, logout, me } as const;
}

export type AuthService = ReturnType<typeof createAuthService>;
