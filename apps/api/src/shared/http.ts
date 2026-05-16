// ---------------------------------------------------------------------------
// Cookie option presets
// Typed for use with Hono v4's setCookie helper (hono/cookie).
// ---------------------------------------------------------------------------

export type CookieOptions = {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Lax' | 'Strict' | 'None';
  readonly path?: string;
  readonly maxAge?: number;
};

/**
 * Options for the short-lived session (JWT access token) cookie.
 * HttpOnly=true prevents JS access; Secure=true enforces HTTPS.
 */
export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

/**
 * Options for the long-lived refresh token cookie.
 * Same security posture as the session cookie.
 */
export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

/**
 * Options for the CSRF double-submit cookie.
 * HttpOnly=false so the browser-side JS can read and echo the value
 * in the X-CSRF-Token header on state-changing requests.
 */
export const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

// ---------------------------------------------------------------------------
// parseCookies — lightweight Cookie header parser
// ---------------------------------------------------------------------------

/**
 * Parses the value of an HTTP `Cookie` header into a key/value record.
 * Handles URL-encoded values and skips malformed pairs gracefully.
 *
 * @param headerValue - The raw Cookie header string, e.g. "a=1; b=2".
 * @returns A plain record of cookie names to decoded values.
 */
export function parseCookies(headerValue: string): Record<string, string> {
  if (!headerValue) return {};

  const result: Record<string, string> = {};

  for (const pair of headerValue.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;

    const name = pair.slice(0, eqIdx).trim();
    const raw = pair.slice(eqIdx + 1).trim();

    if (!name) continue;

    try {
      result[name] = decodeURIComponent(raw);
    } catch {
      // Skip cookies whose values cannot be decoded.
      result[name] = raw;
    }
  }

  return result;
}
