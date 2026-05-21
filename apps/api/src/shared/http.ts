// ---------------------------------------------------------------------------
// Cookie option presets (§5.4)
//
// Session and refresh cookies:  httpOnly, Secure, SameSite=Lax
// CSRF cookie:                  httpOnly=false (SPA must read it), Secure, SameSite=Lax
//
// Use with hono/cookie's setCookie(c, name, value, options).
// ---------------------------------------------------------------------------

export interface CookieOptions {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: 'Lax' | 'Strict' | 'None';
  readonly path: string;
}

/** Short-lived session JWT cookie — HttpOnly, never readable by JS. */
export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
};

/** Long-lived rotating refresh-token cookie — HttpOnly, never readable by JS. */
export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
};

/** CSRF double-submit cookie — NOT HttpOnly so the SPA can read it for the header. */
export const csrfCookieOptions: CookieOptions = {
  httpOnly: false,
  secure: true,
  sameSite: 'Lax',
  path: '/',
};

// ---------------------------------------------------------------------------
// Cookie header parser
// ---------------------------------------------------------------------------

/**
 * Parse the raw value of a `Cookie` request header into a name→value map.
 *
 * Follows RFC 6265 §5.2: pairs are separated by "; ", values are NOT
 * URL-decoded here because cookie values set by `setCookie` are already raw.
 * Returns an empty object when the header is absent or empty.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const pair of header.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (name.length > 0) {
      result[name] = value;
    }
  }

  return result;
}
