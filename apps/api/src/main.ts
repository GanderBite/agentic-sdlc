/**
 * main.ts — API server bootstrap
 *
 * Boot-time responsibilities:
 *   1. Validate required env vars (JWT_SECRET, DATABASE_URL) before opening a port.
 *   2. Build infrastructure singletons (pg pool, drizzle db).
 *   3. Wire auth service deps (signSessionJwt, hashRefreshToken, etc.).
 *   4. Build the Hono app via createApp.
 *   5. Start @hono/node-server on PORT (default 3000).
 *   6. Register graceful shutdown on SIGTERM / SIGINT.
 */
import { createHash, createSecretKey, randomBytes } from 'node:crypto';

import { serve } from '@hono/node-server';
import { SignJWT } from 'jose';
import { createApp } from './app.js';
import { authn } from './middleware/authn.js';
import type { UserClaims } from './modules/auth/index.js';
import { createAuthService } from './modules/auth/index.js';
import { createLoginThrottle } from './modules/auth/throttle.js';
import { db, pool } from './shared/db.js';
import { logger } from './shared/logger.js';
import { createPasswordVerifier } from './shared/password.js';

// ---------------------------------------------------------------------------
// Boot-time env validation — fail fast before opening a port
// ---------------------------------------------------------------------------

const jwtSecret = process.env['JWT_SECRET'];
if (jwtSecret === undefined || jwtSecret.length < 32) {
  throw new Error('JWT_SECRET env var must be set and at least 32 characters');
}

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL env var must be set');
}

// ---------------------------------------------------------------------------
// Auth service deps
// ---------------------------------------------------------------------------

const secretKey = createSecretKey(Buffer.from(jwtSecret, 'utf8'));

/** Sign a 15-minute HS256 session JWT from the provided claims. */
async function signSessionJwt(claims: UserClaims): Promise<string> {
  return new SignJWT({
    sub: claims.userId,
    email: claims.email,
    role: claims.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti(randomBytes(16).toString('hex'))
    .sign(secretKey);
}

/** Deterministic sha256 hex digest of a raw refresh token. */
function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

const throttle = createLoginThrottle();
const verifyPassword = createPasswordVerifier().verify;
const now = (): Date => new Date();

const authService = createAuthService({
  db,
  throttle,
  verifyPassword,
  signSessionJwt,
  hashRefreshToken,
  now,
  log: logger,
});

// ---------------------------------------------------------------------------
// Build app
// ---------------------------------------------------------------------------

const app = createApp({ service: authService, authn });

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const portRaw = process.env['PORT'];
const port = portRaw ? Number(portRaw) : 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT env must be a port number 1-65535');
}

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, `api listening on PORT=${info.port}`);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(sig: string): Promise<void> {
  logger.info({ sig }, 'shutting down');
  server.close(() => {
    pool
      .end()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        logger.error({ err }, 'pool.end failed');
        process.exit(1);
      });
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
