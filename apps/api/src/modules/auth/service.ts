/**
 * auth/service.ts — Auth service factory with DI for testability.
 *
 * Layering rule (ARCHITECTURE §2.3): routes → service → repo.
 * This file may import from repo, passwords, tokens, shared/{errors,logger,ids,time,env}.
 * It MUST NOT import from db/client or routes.
 */
import { randomBytes } from 'node:crypto';

import { env } from '../../shared/env.js';
import { UnauthorizedError } from '../../shared/errors.js';
import type { Clock } from '../../shared/time.js';
import type { PasswordHasher } from './passwords.js';
import type {
  RotatedRow,
  User,
  findRefreshTokenAnywhere,
  findUserByEmail,
  findUserById,
  insertRefreshToken,
  revokeAllActiveForUser,
  rotateRefreshToken,
} from './repo.js';
import { createRefreshTokenValue, createSessionToken, hashRefreshToken } from './tokens.js';

// ---------------------------------------------------------------------------
// Pino-shaped logger interface (subset) — keeps the service decoupled from
// the concrete pino import.  The caller supplies a request-scoped child.
// ---------------------------------------------------------------------------

export interface ServiceLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
}

// ---------------------------------------------------------------------------
// Repo dependency shape — mirrors the functions exported from repo.ts so tests
// can substitute stubs without touching the DB.
// ---------------------------------------------------------------------------

export interface AuthRepo {
  findUserByEmail: typeof findUserByEmail;
  findUserById: typeof findUserById;
  insertRefreshToken: typeof insertRefreshToken;
  rotateRefreshToken: typeof rotateRefreshToken;
  findRefreshTokenAnywhere: typeof findRefreshTokenAnywhere;
  revokeAllActiveForUser: typeof revokeAllActiveForUser;
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface AuthServiceOptions {
  readonly repo: AuthRepo;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
  readonly logger: ServiceLogger;
}

// ---------------------------------------------------------------------------
// Return shapes
// ---------------------------------------------------------------------------

export interface LoginResult {
  readonly user: User;
  readonly sessionJwt: string;
  readonly refreshTokenRaw: string;
  readonly csrfToken: string;
}

export interface MeResult {
  readonly user: User;
}

// ---------------------------------------------------------------------------
// Dummy argon2id hash used as the "user not found" branch constant.
// This value was produced by argon2id with default params so that
// hasher.verify spends the same wall-clock time as a real hash comparison,
// guaranteeing a constant number of verify calls per login attempt (exactly 1).
// ---------------------------------------------------------------------------
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$placeholder000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function issueTokenPair(
  user: User,
  clock: Clock,
  repo: AuthRepo,
): Promise<{ sessionJwt: string; refreshTokenRaw: string; csrfToken: string }> {
  const sessionJwt = await createSessionToken(
    { userId: user.id, role: user.role },
    env.JWT_SECRET,
    env.SESSION_TTL,
  );

  const refreshTokenRaw = createRefreshTokenValue();
  const csrfToken = randomBytes(32).toString('base64url');
  const hash = await hashRefreshToken(refreshTokenRaw);
  const expiresAt = new Date(clock.now().getTime() + env.REFRESH_TTL * 1000);

  await repo.insertRefreshToken({ userId: user.id, hash, expiresAt });

  return { sessionJwt, refreshTokenRaw, csrfToken };
}

// ---------------------------------------------------------------------------
// Auth service
// ---------------------------------------------------------------------------

export interface AuthService {
  login(email: string, plain: string): Promise<LoginResult>;
  refresh(refreshRaw: string, requestId?: string): Promise<LoginResult>;
  logout(refreshRaw: string): Promise<void>;
  me(userId: string): Promise<MeResult>;
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const { repo, hasher, clock, logger } = opts;

  return {
    // -----------------------------------------------------------------------
    // login
    // Constant-time: hasher.verify is called EXACTLY ONCE regardless of
    // whether the email was found (acceptance bullet 14).
    // -----------------------------------------------------------------------
    async login(email: string, plain: string): Promise<LoginResult> {
      const found = await repo.findUserByEmail(email);

      // Always call verify once — use the stored hash when found, the dummy
      // constant when not, so unknown-email and wrong-password branches are
      // indistinguishable to timing attacks.
      const hashToVerify = found !== undefined ? found.passwordHash : DUMMY_HASH;
      const valid = await hasher.verify(hashToVerify, plain);

      if (!found || !valid) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const tokens = await issueTokenPair(found, clock, repo);
      return { user: found, ...tokens };
    },

    // -----------------------------------------------------------------------
    // refresh
    // Rotates the incoming refresh token; detects replay attacks via
    // findRefreshTokenAnywhere and triggers token-family revocation.
    // -----------------------------------------------------------------------
    async refresh(refreshRaw: string, requestId?: string): Promise<LoginResult> {
      const hash = await hashRefreshToken(refreshRaw);
      const rotated: RotatedRow | null = await repo.rotateRefreshToken(hash);

      if (rotated === null) {
        // Check whether this hash exists at all (already-revoked = replay).
        const existing = await repo.findRefreshTokenAnywhere(hash);
        if (existing !== undefined) {
          const userId = existing.userId;
          await repo.revokeAllActiveForUser(userId);
          logger.warn(
            { msg: 'refresh.replay_detected', userId, requestId },
            'refresh.replay_detected',
          );
          throw new UnauthorizedError('Refresh token replayed');
        }
        // Hash is completely unknown.
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Token was valid — check expiry.
      if (rotated.expiresAt < clock.now()) {
        throw new UnauthorizedError('Refresh token expired');
      }

      const found = await repo.findUserById(rotated.userId);
      if (found === undefined) {
        throw new UnauthorizedError('User not found');
      }

      const tokens = await issueTokenPair(found, clock, repo);
      return { user: found, ...tokens };
    },

    // -----------------------------------------------------------------------
    // logout
    // Revokes the single refresh token row associated with the raw value.
    // -----------------------------------------------------------------------
    async logout(refreshRaw: string): Promise<void> {
      const hash = await hashRefreshToken(refreshRaw);
      // rotateRefreshToken marks the row as revoked atomically.
      await repo.rotateRefreshToken(hash);
    },

    // -----------------------------------------------------------------------
    // me
    // Hydrates the current user from a validated JWT claim.
    // -----------------------------------------------------------------------
    async me(userId: string): Promise<MeResult> {
      const found = await repo.findUserById(userId);
      if (found === undefined) {
        throw new UnauthorizedError('User not found');
      }
      return { user: found };
    },
  };
}
