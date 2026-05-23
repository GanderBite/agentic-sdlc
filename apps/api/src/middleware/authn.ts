import { createSecretKey } from 'node:crypto';
import type { Role } from '@medbridge/contracts';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { jwtVerify } from 'jose';

import { UnauthorizedError } from '../shared/errors.js';

/**
 * authn middleware
 *
 * Reads the `session` HttpOnly cookie and verifies it as an HS256 JWT using
 * the JWT_SECRET environment variable. The algorithm is pinned to HS256 via
 * the `algorithms` option so tokens signed with HS384, HS512, or any other
 * algorithm are rejected even when the same secret is used.
 *
 * A clockTolerance of 5 seconds is passed to jwtVerify to honour the B12
 * 5-second clock-skew guarantee defined in ARCHITECTURE §B12.
 *
 * On success, attaches `{ id, email, role }` to `c.get("user")`.
 * On a missing cookie for a protected route, throws UnauthorizedError (401).
 * On a verification failure, throws UnauthorizedError (401).
 */
export const authn: MiddlewareHandler = async (c, next): Promise<void> => {
  const sessionCookie = getCookie(c, 'session');

  if (sessionCookie === undefined || sessionCookie === '') {
    throw new UnauthorizedError('Session cookie missing');
  }

  const secret = process.env['JWT_SECRET'];

  if (secret === undefined || secret === '') {
    throw new UnauthorizedError('Server misconfiguration: JWT_SECRET not set');
  }

  const secretKey = createSecretKey(Buffer.from(secret, 'utf8'));

  try {
    const { payload } = await jwtVerify(sessionCookie, secretKey, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });

    const id = payload['sub'];
    const email = payload['email'];
    const role = payload['role'] as Role | undefined;

    if (typeof id !== 'string' || typeof email !== 'string' || typeof role !== 'string') {
      throw new UnauthorizedError('Invalid JWT payload');
    }

    c.set('user', { id, email, role });
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      throw e;
    }
    throw new UnauthorizedError('Invalid or expired session');
  }

  await next();
};
