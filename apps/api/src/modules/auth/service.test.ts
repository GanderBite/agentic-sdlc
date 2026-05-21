/**
 * auth/service.test.ts — colocated unit tests for createAuthService.
 *
 * No Postgres / no testcontainers. AuthRepo and PasswordHasher are supplied as
 * vi.fn()-backed objects injected through the DI constructor (AuthServiceOptions).
 * env and tokens are module-mocked so the test process does not require real
 * environment variables or JWT signing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env before any module that transitively imports it executes.
// vi.mock is hoisted above all imports automatically.
// ---------------------------------------------------------------------------
vi.mock('../../shared/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long!!',
    SESSION_TTL: 900,
    REFRESH_TTL: 604800,
    UPLOAD_DIR: '/tmp/uploads',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock tokens so createSessionToken / createRefreshTokenValue / hashRefreshToken
// return deterministic values without real crypto.
// ---------------------------------------------------------------------------
vi.mock('./tokens.js', () => ({
  createSessionToken: vi.fn(),
  createRefreshTokenValue: vi.fn(),
  hashRefreshToken: vi.fn(),
}));

import { UnauthorizedError } from '../../shared/errors.js';
import type { RotatedRow, User } from './repo.js';
import { createAuthService } from './service.js';
import type { AuthRepo, AuthService, AuthServiceOptions, ServiceLogger } from './service.js';
import * as tokens from './tokens.js';

// ---------------------------------------------------------------------------
// Factories for test data
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    role: 'patient',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$fakehash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeRotatedRow(overrides: Partial<RotatedRow> = {}): RotatedRow {
  return {
    id: 'rt-1',
    userId: 'user-1',
    expiresAt: new Date('2026-06-01T00:00:00.000Z'), // future
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock repo factory — all fns are vi.fn() stubs, caller overrides per-test
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<AuthRepo> = {}): AuthRepo {
  return {
    findUserByEmail: vi.fn(),
    findUserById: vi.fn(),
    insertRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    findRefreshTokenAnywhere: vi.fn(),
    revokeAllActiveForUser: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock logger factory
// ---------------------------------------------------------------------------

function makeLogger(): ServiceLogger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

// ---------------------------------------------------------------------------
// Shared clock — frozen at a point in the future so tokens are not expired.
// ---------------------------------------------------------------------------
const FIXED_NOW = new Date('2026-05-21T10:00:00.000+00:00');

function makeService(repo: AuthRepo, logger: ServiceLogger): AuthService {
  const hasherStub: AuthServiceOptions['hasher'] = {
    hash: vi.fn(),
    verify: vi.fn(),
  };
  // expose hasher so per-test can configure it
  (makeService as unknown as Record<string, unknown>)._lastHasher = hasherStub;
  return createAuthService({
    repo,
    hasher: hasherStub,
    clock: { now: () => FIXED_NOW },
    logger,
  });
}

// ---------------------------------------------------------------------------
// beforeEach: wire deterministic token stubs and clear mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.mocked(tokens.createSessionToken).mockResolvedValue('session-jwt-stub');
  vi.mocked(tokens.createRefreshTokenValue).mockReturnValue('refresh-raw-stub');
  vi.mocked(tokens.hashRefreshToken).mockResolvedValue('refresh-hash-stub');
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper that builds a service AND returns the hasher mock for assertions
// ---------------------------------------------------------------------------

function makeServiceWithHasher(repo: AuthRepo, logger: ServiceLogger) {
  const hasher: AuthServiceOptions['hasher'] = {
    hash: vi.fn(),
    verify: vi.fn(),
  };
  const service = createAuthService({
    repo,
    hasher,
    clock: { now: () => FIXED_NOW },
    logger,
  });
  return { service, hasher };
}

// ===========================================================================
// auth.service.login
// ===========================================================================

describe('auth.service.login', () => {
  it('when email and password are correct, then returns user + tokens and calls verify exactly once', async () => {
    // arrange
    const user = makeUser();
    const repo = makeRepo({
      findUserByEmail: vi.fn().mockResolvedValue(user),
      insertRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-1',
        userId: user.id,
        hash: 'refresh-hash-stub',
        issuedAt: FIXED_NOW,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        replacedBy: null,
      }),
    });
    const logger = makeLogger();
    const { service, hasher } = makeServiceWithHasher(repo, logger);
    vi.mocked(hasher.verify).mockResolvedValue(true);

    // act
    const result = await service.login('alice@example.com', 'correct-password');

    // assert
    expect(result.user).toEqual(user);
    expect(result.sessionJwt).toBe('session-jwt-stub');
    expect(result.refreshTokenRaw).toBe('refresh-raw-stub');
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('when email is unknown, then hasher.verify is called exactly once (constant-time) and throws UnauthorizedError', async () => {
    // arrange — repo returns undefined (unknown email)
    const repo = makeRepo({
      findUserByEmail: vi.fn().mockResolvedValue(undefined),
    });
    const logger = makeLogger();
    const { service, hasher } = makeServiceWithHasher(repo, logger);
    // verify resolves false (dummy hash won't match but timing must be kept)
    vi.mocked(hasher.verify).mockResolvedValue(false);

    // act + assert
    await expect(service.login('unknown-email@example.com', 'any-password')).rejects.toThrow(
      UnauthorizedError,
    );

    // constant-time guarantee: verify must be called exactly once even for unknown email
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    // repo must NOT have issued a token
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(0);
  });

  it('when email exists but wrong password, then verify returns false and throws UnauthorizedError', async () => {
    // arrange
    const user = makeUser();
    const repo = makeRepo({
      findUserByEmail: vi.fn().mockResolvedValue(user),
    });
    const logger = makeLogger();
    const { service, hasher } = makeServiceWithHasher(repo, logger);
    vi.mocked(hasher.verify).mockResolvedValue(false);

    // act + assert
    await expect(service.login('alice@example.com', 'wrong password')).rejects.toThrow(
      UnauthorizedError,
    );

    // verify must be called exactly once
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    // no token should be issued
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// auth.service.refresh
// ===========================================================================

describe('auth.service.refresh', () => {
  it('when token is valid and not expired, then rotates and returns new token pair without warn log', async () => {
    // arrange
    const user = makeUser();
    const rotatedRow = makeRotatedRow({
      userId: user.id,
      expiresAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    const repo = makeRepo({
      rotateRefreshToken: vi.fn().mockResolvedValue(rotatedRow),
      findUserById: vi.fn().mockResolvedValue(user),
      insertRefreshToken: vi.fn().mockResolvedValue({
        id: 'rt-2',
        userId: user.id,
        hash: 'refresh-hash-stub',
        issuedAt: FIXED_NOW,
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        revokedAt: null,
        replacedBy: null,
      }),
    });
    const logger = makeLogger();
    const { service } = makeServiceWithHasher(repo, logger);

    // act
    const result = await service.refresh('some-raw-token');

    // assert
    expect(result.user).toEqual(user);
    expect(result.sessionJwt).toBe('session-jwt-stub');
    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(1);
    // no warn emitted on happy path
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });

  it('when token rotate returns null and token exists (replay attack), then revokeAllActiveForUser is called, exactly one warn log is emitted, and throws UnauthorizedError', async () => {
    // arrange — replay scenario: rotate returns null, but findRefreshTokenAnywhere finds the row
    const existingToken = {
      id: 'rt-1',
      userId: 'user-1',
      hash: 'refresh-hash-stub',
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      revokedAt: new Date('2026-01-02T00:00:00.000Z'), // already revoked
      replacedBy: null,
    };
    const repo = makeRepo({
      rotateRefreshToken: vi.fn().mockResolvedValue(null),
      findRefreshTokenAnywhere: vi.fn().mockResolvedValue(existingToken),
      revokeAllActiveForUser: vi.fn().mockResolvedValue(undefined),
    });
    const logger = makeLogger();
    const { service } = makeServiceWithHasher(repo, logger);

    // act + assert
    await expect(service.refresh('replayed-token')).rejects.toThrow(UnauthorizedError);

    // rotate was called once and returned null
    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    // findRefreshTokenAnywhere was called to detect replay
    expect(repo.findRefreshTokenAnywhere).toHaveBeenCalledTimes(1);
    // token-family revocation must be called
    expect(repo.revokeAllActiveForUser).toHaveBeenCalledTimes(1);
    // exactly one warn log emitted for the replay event
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('when token rotate returns null and token does not exist (unknown token), then throws UnauthorizedError without warn', async () => {
    // arrange — completely unknown token
    const repo = makeRepo({
      rotateRefreshToken: vi.fn().mockResolvedValue(null),
      findRefreshTokenAnywhere: vi.fn().mockResolvedValue(undefined),
    });
    const logger = makeLogger();
    const { service } = makeServiceWithHasher(repo, logger);

    // act + assert
    await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedError);

    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    expect(repo.findRefreshTokenAnywhere).toHaveBeenCalledTimes(1);
    expect(repo.revokeAllActiveForUser).toHaveBeenCalledTimes(0);
    expect(logger.warn).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// auth.service.logout
// ===========================================================================

describe('auth.service.logout', () => {
  it('when logout is called, then rotateRefreshToken is called exactly once with the hashed token', async () => {
    // arrange
    const repo = makeRepo({
      rotateRefreshToken: vi.fn().mockResolvedValue(null), // return value not checked by logout
    });
    const logger = makeLogger();
    const { service } = makeServiceWithHasher(repo, logger);

    // act
    await service.logout('raw-token-value');

    // assert — the specified token row is revoked
    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    // hashRefreshToken was called to derive the hash before rotation
    expect(tokens.hashRefreshToken).toHaveBeenCalledTimes(1);
  });
});
