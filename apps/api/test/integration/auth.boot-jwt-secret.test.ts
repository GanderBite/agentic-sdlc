/**
 * auth.boot-jwt-secret.test.ts
 *
 * Adversarial smoke: verifies that the application refuses to start when
 * JWT_SECRET is shorter than 32 bytes, and surfaces a useful error message
 * that mentions JWT_SECRET and the minimum length (32).
 *
 * No Postgres container is needed — the env validation throws synchronously
 * before any DB connection is attempted.
 *
 * Acceptance bullet 10.
 */

vi.hoisted(() => {
  // Provide valid placeholder env vars so env.ts module-level singleton loads
  // without throwing. The tests then call loadEnv() with custom inputs to
  // exercise the validation logic.
  process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  process.env.JWT_SECRET = 'placeholder-jwt-secret-32-bytes!';
  process.env.NODE_ENV = 'test';
});

import { describe, expect, it, vi } from 'vitest';

import { loadEnv } from '../../src/shared/env.js';

describe('auth.boot-jwt-secret', () => {
  it('when JWT_SECRET is shorter than 32 bytes, then loadEnv throws an Error mentioning JWT_SECRET and 32', () => {
    // arrange — a secret that is too short
    const badEnv = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'tooshort',
    };

    // act + assert
    expect(() => loadEnv(badEnv)).toThrow(Error);
    expect(() => loadEnv(badEnv)).toThrow(/JWT_SECRET/);
    expect(() => loadEnv(badEnv)).toThrow(/32/);
  });

  it('when JWT_SECRET is exactly 32 bytes, then loadEnv succeeds without throwing', () => {
    // arrange — exactly 32 ASCII characters
    const goodEnv = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'exactly-32-bytes-secret-value-xx',
    };

    // act + assert — must not throw
    expect(() => loadEnv(goodEnv)).not.toThrow();
  });

  it('when JWT_SECRET is missing entirely, then loadEnv throws an Error mentioning JWT_SECRET', () => {
    // arrange — no JWT_SECRET at all
    const noSecretEnv: Record<string, string> = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    };

    // act + assert
    expect(() => loadEnv(noSecretEnv)).toThrow(/JWT_SECRET/);
  });

  it('when JWT_SECRET is 33 bytes, then loadEnv succeeds without throwing', () => {
    // arrange — one byte over the minimum
    const goodEnv = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_SECRET: 'exactly-33-bytes-secret-value-xxx',
    };

    // act + assert
    expect(() => loadEnv(goodEnv)).not.toThrow();
  });
});
