/**
 * Unit tests for createAuthService.
 *
 * All collaborators (repo, hasher, clock, logger) are vi.fn()-mocked so this
 * suite runs without a database. The db import in service.ts (used only in
 * refresh and me for inline user look-ups) is module-mocked below.
 *
 * The env import and tokens module are mocked to avoid environment-variable
 * validation failures at import time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ../../db/client.ts — service.ts imports `db` directly for refresh/me
// Use vi.hoisted so the variable is available inside the hoisted vi.mock factory
// ---------------------------------------------------------------------------

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock('../../db/client.ts', () => ({
  db: {
    select: mockDbSelect,
  },
  pool: {},
  createDb: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock ../../shared/env.ts — consumed at import time by tokens.ts
// ---------------------------------------------------------------------------

vi.mock('../../shared/env.ts', () => ({
  loadEnv: vi.fn(() => ({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long!!',
    SESSION_TTL: 900,
    REFRESH_TTL: 604800,
    UPLOAD_DIR: '/tmp',
    LOG_LEVEL: 'info' as const,
    NODE_ENV: 'test' as const,
  })),
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'test-secret-that-is-at-least-32-bytes-long!!',
    SESSION_TTL: 900,
    REFRESH_TTL: 604800,
    UPLOAD_DIR: '/tmp',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock the tokens module — avoids env validation and jose dependency at load
// ---------------------------------------------------------------------------

vi.mock('./tokens.ts', () => ({
  createSessionToken: vi.fn().mockResolvedValue('mock-session-jwt'),
  createRefreshTokenValue: vi.fn().mockReturnValue('mock-refresh-raw'),
  hashRefreshToken: vi.fn((raw: string) => `hash-of-${raw}`),
  verifySessionToken: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are hoisted
// ---------------------------------------------------------------------------

import { UnauthorizedError } from '../../shared/errors.ts';
import type { PasswordHasher } from './passwords.ts';
import { createAuthService } from './service.ts';
import type { AuthRepo } from './service.ts';
import type { Clock, ServiceLogger } from './service.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-05-16T12:00:00.000Z');

function makeUser(
  overrides: Partial<{
    id: string;
    email: string;
    role: string;
    passwordHash: string;
    createdAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    role: 'patient',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$real-salt$real-hash',
    createdAt: FIXED_NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeRefreshTokenRow(
  overrides: Partial<{
    id: string;
    userId: string;
    hash: string;
    issuedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    replacedBy: string | null;
  }> = {},
) {
  return {
    id: 'rt-1',
    userId: 'user-1',
    hash: 'hash-of-mock-refresh-raw',
    issuedAt: FIXED_NOW,
    expiresAt: new Date(FIXED_NOW.getTime() + 604800 * 1000),
    revokedAt: null,
    replacedBy: null,
    ...overrides,
  };
}

function makeRotatedRow(
  overrides: Partial<{
    id: string;
    userId: string;
    expiresAt: Date;
  }> = {},
) {
  return {
    id: 'rt-1',
    userId: 'user-1',
    expiresAt: new Date(FIXED_NOW.getTime() + 604800 * 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock collaborators
// ---------------------------------------------------------------------------

function makeRepo(): AuthRepo {
  return {
    findUserByEmail: vi.fn(),
    insertUser: vi.fn(),
    insertRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    findRefreshTokenAnywhere: vi.fn(),
    revokeAllActiveForUser: vi.fn(),
  };
}

function makeHasher(): PasswordHasher {
  return {
    hash: vi.fn(),
    verify: vi.fn(),
  };
}

function makeClock(): Clock {
  return {
    now: vi.fn().mockReturnValue(FIXED_NOW),
  };
}

function makeLogger(): ServiceLogger {
  return {
    warn: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helper: configure mockDbSelect chain for db.select().from().where().limit()
// ---------------------------------------------------------------------------

function setupDbSelectResult(rows: unknown[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  mockDbSelect.mockReturnValue({ from: fromMock });
}

// ---------------------------------------------------------------------------
// beforeEach: reset mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // no fake timers used but ensure clean state
});

// ===========================================================================
// login
// ===========================================================================

describe('auth.service.login', () => {
  it('when credentials are valid, then verifies password once, inserts refresh token once, returns user + tokens', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();
    const user = makeUser();

    vi.mocked(repo.findUserByEmail).mockResolvedValueOnce(user);
    vi.mocked(hasher.verify).mockResolvedValueOnce(true);
    vi.mocked(repo.insertRefreshToken).mockResolvedValueOnce(makeRefreshTokenRow());

    const service = createAuthService({ repo, hasher, clock, logger });

    // act
    const result = await service.login('alice@example.com', 'correct-password');

    // assert
    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(hasher.verify).toHaveBeenCalledWith(user.passwordHash, 'correct-password');
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(1);
    expect(result.user).toEqual({ id: user.id, email: user.email, role: user.role });
    expect(typeof result.sessionJwt).toBe('string');
    expect(typeof result.refreshTokenRaw).toBe('string');
    expect(typeof result.csrfToken).toBe('string');
  });

  it('when email is unknown, then hasher.verify is still called exactly once with a dummy hash, throws UnauthorizedError', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();

    vi.mocked(repo.findUserByEmail).mockResolvedValueOnce(undefined);
    vi.mocked(hasher.verify).mockResolvedValueOnce(false);

    const service = createAuthService({ repo, hasher, clock, logger });

    // act + assert — unknown email path must still call verify exactly once
    await expect(service.login('unknown-email@example.com', 'any-password')).rejects.toThrow(
      UnauthorizedError,
    );

    expect(hasher.verify).toHaveBeenCalledTimes(1);
    // The first argument must be the FAKE_STORED_HASH (a decoy, not the input)
    const [firstArg] = vi.mocked(hasher.verify).mock.calls[0] ?? [];
    expect(typeof firstArg).toBe('string');
    expect((firstArg as string).length).toBeGreaterThan(0);
    // Must NOT have tried to insert a refresh token
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(0);
  });

  it('when password is wrong, then hasher.verify is called exactly once and resolves false, throws UnauthorizedError', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();
    const user = makeUser();

    vi.mocked(repo.findUserByEmail).mockResolvedValueOnce(user);
    vi.mocked(hasher.verify).mockResolvedValueOnce(false);

    const service = createAuthService({ repo, hasher, clock, logger });

    // act + assert — wrong password path
    await expect(service.login('alice@example.com', 'wrong-password')).rejects.toThrow(
      UnauthorizedError,
    );

    expect(hasher.verify).toHaveBeenCalledTimes(1);
    expect(hasher.verify).toHaveBeenCalledWith(user.passwordHash, 'wrong-password');
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// refresh
// ===========================================================================

describe('auth.service.refresh', () => {
  it('when refresh token is valid (happy path), then issues new token pair without warning', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();
    const user = makeUser();
    const rotated = makeRotatedRow();

    vi.mocked(repo.rotateRefreshToken).mockResolvedValueOnce(rotated);
    vi.mocked(repo.insertRefreshToken).mockResolvedValueOnce(makeRefreshTokenRow());

    // db.select() chain for the user lookup inside refresh()
    setupDbSelectResult([user]);

    const service = createAuthService({ repo, hasher, clock, logger });

    // act
    const result = await service.refresh('valid-refresh-token', 'req-id-1');

    // assert
    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    expect(repo.insertRefreshToken).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(0);
    expect(result.user).toEqual({ id: user.id, email: user.email, role: user.role });
    expect(typeof result.sessionJwt).toBe('string');
    expect(typeof result.refreshTokenRaw).toBe('string');
  });

  it('when refresh token is replayed (rotateRefreshToken returns null, findRefreshTokenAnywhere returns a row), then calls revokeAllActiveForUser, emits exactly one warn log, throws UnauthorizedError', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();
    const existingTokenRow = makeRefreshTokenRow({ revokedAt: FIXED_NOW });

    vi.mocked(repo.rotateRefreshToken).mockResolvedValueOnce(null);
    vi.mocked(repo.findRefreshTokenAnywhere).mockResolvedValueOnce(existingTokenRow);
    vi.mocked(repo.revokeAllActiveForUser).mockResolvedValueOnce(undefined);

    const service = createAuthService({ repo, hasher, clock, logger });

    // act + assert
    await expect(service.refresh('replayed-token', 'req-id-replay')).rejects.toThrow(
      UnauthorizedError,
    );

    expect(repo.revokeAllActiveForUser).toHaveBeenCalledTimes(1);
    expect(repo.revokeAllActiveForUser).toHaveBeenCalledWith(existingTokenRow.userId);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// logout
// ===========================================================================

describe('auth.service.logout', () => {
  it('when logout is called with a token, then revokes the specified row via rotateRefreshToken', async () => {
    // arrange
    const repo = makeRepo();
    const hasher = makeHasher();
    const clock = makeClock();
    const logger = makeLogger();

    vi.mocked(repo.rotateRefreshToken).mockResolvedValueOnce(makeRotatedRow());

    const service = createAuthService({ repo, hasher, clock, logger });

    // act
    await service.logout('some-refresh-token');

    // assert
    expect(repo.rotateRefreshToken).toHaveBeenCalledTimes(1);
  });
});
