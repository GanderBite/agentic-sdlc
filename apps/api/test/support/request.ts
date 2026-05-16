import type { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Cookie jar helpers
// ---------------------------------------------------------------------------

/**
 * Parse a single Set-Cookie header value into its name and value parts.
 * Only the name=value pair is extracted — attributes (Path, HttpOnly, etc.) are dropped.
 */
function parseCookiePair(setCookieHeader: string): [string, string] | null {
  const first = setCookieHeader.split(';')[0];
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq === -1) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  return [name, value];
}

/**
 * Extract all Set-Cookie header values from a Response.
 * Uses getSetCookie() when available (Node 22+); falls back to the raw header.
 */
function extractSetCookieHeaders(response: Response): string[] {
  // getSetCookie() is available in Node 22 / undici and returns all values for
  // the multi-value Set-Cookie header correctly.
  if (typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (response.headers as { getSetCookie: () => string[] }).getSetCookie();
  }
  // Fallback: raw() is available on undici/node-fetch Headers but not on the
  // standard spec Headers — guard before use.
  const rawHeaders = response.headers as {
    raw?: () => Record<string, string[]>;
    get?: (k: string) => string | null;
  };
  if (typeof rawHeaders.raw === 'function') {
    return rawHeaders.raw()['set-cookie'] ?? [];
  }
  // Last-resort: a single comma-joined string (won't work for multi-cookie with
  // Expires containing commas, but covers simple cases).
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

// ---------------------------------------------------------------------------
// Request agent
// ---------------------------------------------------------------------------

export interface RequestAgent {
  request(path: string, init?: RequestInit): Promise<Response>;
  cookies(): Map<string, string>;
}

/**
 * Wrap a Hono app so that successive calls share an in-memory cookie jar.
 * Set-Cookie headers from every response are parsed and stored;
 * each outgoing request receives a Cookie header built from the jar.
 */
export function createRequestAgent(app: Hono): RequestAgent {
  const jar = new Map<string, string>();

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    // Attach current jar as Cookie header, merging with any caller-supplied cookies.
    const headers = new Headers(init.headers);
    if (jar.size > 0) {
      const cookieString = Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
      headers.set('cookie', cookieString);
    }

    const response = await app.request(path, { ...init, headers });

    // Update the jar from Set-Cookie headers in the response.
    for (const setCookie of extractSetCookieHeaders(response)) {
      const pair = parseCookiePair(setCookie);
      if (pair) {
        jar.set(pair[0], pair[1]);
      }
    }

    return response;
  }

  function cookies(): Map<string, string> {
    return jar;
  }

  return { request, cookies };
}

// ---------------------------------------------------------------------------
// CSRF helper
// ---------------------------------------------------------------------------

/**
 * Read the current csrf_token value from the agent's cookie jar and return
 * the header object that satisfies the CSRF double-submit check.
 *
 * Throws if the csrf_token cookie is not present in the jar.
 */
export function csrfHeaders(agent: RequestAgent): { 'X-CSRF-Token': string } {
  const token = agent.cookies().get('csrf_token');
  if (token === undefined) {
    throw new Error(
      'csrfHeaders(): csrf_token cookie not found in jar. ' +
        'Ensure a login/csrf-issue call has been made before reading the token.',
    );
  }
  return { 'X-CSRF-Token': token };
}
