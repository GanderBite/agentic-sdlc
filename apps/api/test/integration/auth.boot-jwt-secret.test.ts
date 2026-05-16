/**
 * Adversarial integration test — JWT_SECRET boot fail-fast.
 *
 * Calling buildApp (or importing it) with a JWT_SECRET shorter than 32 bytes
 * must throw an Error whose message mentions both "JWT_SECRET" and "32"
 * (enriched bullet 10).
 *
 * The fail-fast check lives in apps/api/src/shared/env.ts `loadEnv()`.
 * This test exercises the Zod validation path without starting a container
 * — no I/O is required because the error must occur before DB access.
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// We do NOT vi.hoisted here because we need to test different env values
// per test case.  Instead we call loadEnv directly with an injected env object.
// ---------------------------------------------------------------------------

// Seed a valid JWT_SECRET so module-scope loadEnv() in env.ts does not throw
// during import resolution (env.ts has `export const env = loadEnv()` at module scope).
vi.hoisted(() => {
  process.env.JWT_SECRET = 'integration-test-secret-must-be-at-least-32bytes';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.NODE_ENV = 'test';
});

import { loadEnv } from '../../src/shared/env.ts';

// ---------------------------------------------------------------------------
// Tests — all operate on loadEnv() directly, no container needed.
// ---------------------------------------------------------------------------

describe('JWT_SECRET boot fail-fast (loadEnv)', () => {
  it('throws when JWT_SECRET is shorter than 32 characters', () => {
    // arrange: a short secret (31 chars)
    const shortSecret = 'tooshort-only-31-chars-exactly!!'; // exactly 32 chars would pass, use fewer
    const shortSecret30 = 'this-is-only-30-characters-long';

    expect(() =>
      loadEnv({
        JWT_SECRET: shortSecret30,
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      }),
    ).toThrow();
  });

  it('error message mentions JWT_SECRET when the secret is too short', () => {
    const shortSecret = 'under32';

    let caughtError: unknown;
    try {
      loadEnv({
        JWT_SECRET: shortSecret,
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(Error);
    const errMessage = (caughtError as Error).message;
    expect(errMessage).toContain('JWT_SECRET');
  });

  it('error message mentions 32 (the minimum byte requirement)', () => {
    const shortSecret = 'toolittleentropy123';

    let caughtError: unknown;
    try {
      loadEnv({
        JWT_SECRET: shortSecret,
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(Error);
    const errMessage = (caughtError as Error).message;
    expect(errMessage).toContain('32');
  });

  it('does NOT throw when JWT_SECRET is exactly 32 characters', () => {
    // A 32-character secret must pass validation
    const exactlyThirtyTwo = 'exactly-32-chars-long-secretkey!'; // 32 chars
    expect(exactlyThirtyTwo.length).toBe(32);

    expect(() =>
      loadEnv({
        JWT_SECRET: exactlyThirtyTwo,
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      }),
    ).not.toThrow();
  });

  it('does NOT throw when JWT_SECRET is longer than 32 characters', () => {
    const longSecret = 'integration-test-secret-must-be-at-least-32bytes-and-more';

    expect(() =>
      loadEnv({
        JWT_SECRET: longSecret,
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      }),
    ).not.toThrow();
  });

  it('throws when JWT_SECRET is missing entirely', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://test:test@localhost:5432/test',
        NODE_ENV: 'test',
      }),
    ).toThrow();
  });
});
