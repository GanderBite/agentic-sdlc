import { errorEnvelope, refreshResponse } from '@medbridge/contracts';
import type { ZodSchema } from 'zod';

import { ApiError } from './errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * Auth endpoints that are exempt from 401 refresh-retry to avoid loops.
 * These paths match the server routes mounted at /api/*.
 */
const AUTH_PATHS = new Set(['/api/login', '/api/refresh', '/api/logout']);

// ---------------------------------------------------------------------------
// Single-flight refresh state
// ---------------------------------------------------------------------------

/**
 * Module-level shared refresh promise. When a 401 is encountered on a
 * non-auth request, all concurrent callers coalesce onto this single promise.
 * Cleared on both success and failure so the next 401 starts a fresh flight.
 */
let refreshPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// CSRF helper
// ---------------------------------------------------------------------------

/**
 * Reads the `csrf_token` cookie value.
 * The `csrf_token` cookie is NOT HttpOnly (set by the server so browser JS
 * can read it) — see ARCHITECTURE §5.4 and conventions.md.
 */
function readCsrfToken(): string | null {
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('csrf_token='));

  if (match === undefined) return null;

  const eqIdx = match.indexOf('=');
  if (eqIdx === -1) return null;

  return decodeURIComponent(match.slice(eqIdx + 1));
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

/**
 * Internal fetch wrapper. Sends credentials, attaches CSRF header for unsafe
 * methods, and parses the response body with the given Zod schema.
 *
 * Does NOT handle 401 refresh logic — that is layered on top in `request`.
 */
async function fetchParsed<T>(
  path: string,
  options: RequestInit,
  schema: ZodSchema<T>,
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);

  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken();
    if (token !== null) {
      headers.set('X-CSRF-Token', token);
    }
  }

  if (!headers.has('Content-Type') && options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    let code: ApiError['code'] = 'INTERNAL';
    let message = `Request failed with status ${response.status}`;
    let details: unknown;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body: unknown = await response.json();
        const parsed = errorEnvelope.safeParse(body);
        if (parsed.success) {
          code = parsed.data.error.code;
          if (parsed.data.error.message !== undefined) {
            message = parsed.data.error.message;
          }
          details = parsed.data.error.details;
        }
      } catch {
        // Ignore JSON parse errors — fall back to defaults above.
      }
    }

    throw new ApiError({ code, message, status: response.status, details });
  }

  const body: unknown = await response.json();
  return schema.parse(body);
}

// ---------------------------------------------------------------------------
// Refresh helper (used by the single-flight 401 handler)
// ---------------------------------------------------------------------------

/**
 * Calls POST /api/refresh directly. Used only by the single-flight 401
 * handler; external callers should use `api.refresh()` from auth.ts instead.
 */
async function doRefresh(): Promise<void> {
  await fetchParsed('/api/refresh', { method: 'POST' }, refreshResponse);
}

// ---------------------------------------------------------------------------
// Public request function with single-flight 401 refresh retry
// ---------------------------------------------------------------------------

/**
 * Makes a typed HTTP request. For non-auth paths, a 401 response triggers
 * a single shared POST /api/refresh; all concurrent 401 waiters coalesce onto
 * the same refresh and each replays its original request exactly once.
 */
export async function request<T>(
  path: string,
  options: RequestInit,
  schema: ZodSchema<T>,
): Promise<T> {
  try {
    return await fetchParsed(path, options, schema);
  } catch (err) {
    // Only retry on 401 for non-auth paths.
    if (!(err instanceof ApiError) || err.status !== 401 || AUTH_PATHS.has(path)) {
      throw err;
    }

    // Coalesce concurrent 401s onto a single refresh promise.
    if (refreshPromise === null) {
      refreshPromise = (async () => {
        try {
          await doRefresh();
        } finally {
          // Always clear the shared promise so the next 401 starts fresh.
          refreshPromise = null;
        }
      })();
    }

    // Every waiter (including the one that initiated the refresh) awaits
    // the shared promise. On failure the original 401 ApiError is re-thrown.
    try {
      await refreshPromise;
    } catch {
      throw err;
    }

    // Refresh succeeded — replay the original request exactly once.
    return fetchParsed(path, options, schema);
  }
}
