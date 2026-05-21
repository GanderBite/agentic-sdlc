/**
 * HTTP request helper for integration tests.
 *
 * Wraps a Hono app's `app.request` with:
 *   - an in-memory cookie jar that survives across successive calls (simulates a browser session)
 *   - automatic CSRF double-submit wiring (csrf_token cookie → X-CSRF-Token header)
 *   - a csrfHeaders() helper for one-off manual CSRF header construction
 *
 * Usage:
 *
 *   import { createRequestAgent } from '../support/request.js';
 *
 *   const agent = createRequestAgent(app);
 *
 *   // In beforeEach, reset the cookie jar:
 *   agent.reset();
 *
 *   // Make a request:
 *   const res = await agent.fetch('/auth/login', {
 *     method: 'POST',
 *     body: JSON.stringify({ email: '...', password: '...' }),
 *     headers: { 'Content-Type': 'application/json' },
 *   });
 *
 *   // CSRF headers (for state-changing requests):
 *   const headers = agent.csrfHeaders();
 *   // → { 'X-CSRF-Token': '<value from csrf_token cookie>' }
 */
// ---------------------------------------------------------------------------
// Cookie jar
// ---------------------------------------------------------------------------
/** Minimal in-memory cookie jar that parses Set-Cookie response headers. */
class CookieJar {
    jar = new Map();
    /** Ingest all Set-Cookie headers from a response. */
    ingest(res) {
        // Headers.getSetCookie() returns all Set-Cookie values as an array.
        const setCookies = typeof res.headers.getSetCookie === 'function'
            ? res.headers.getSetCookie()
            : // Fallback for environments without getSetCookie.
                (res.headers.get('set-cookie') ?? '')
                    .split(',')
                    .filter(Boolean);
        for (const raw of setCookies) {
            // Each Set-Cookie header is: name=value; attr; attr...
            const firstSemi = raw.indexOf(';');
            const pair = firstSemi === -1 ? raw : raw.slice(0, firstSemi);
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1)
                continue;
            const name = pair.slice(0, eqIdx).trim();
            const value = pair.slice(eqIdx + 1).trim();
            if (name.length > 0) {
                this.jar.set(name, value);
            }
        }
    }
    /** Build a Cookie header value from all stored cookies. */
    toCookieHeader() {
        return Array.from(this.jar.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }
    /** Read a single cookie value by name. */
    get(name) {
        return this.jar.get(name);
    }
    /** Clear all stored cookies. */
    clear() {
        this.jar.clear();
    }
}
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/**
 * Create a request agent wrapping the supplied Hono app.
 *
 * The agent maintains an in-memory cookie jar across successive calls so
 * tests can perform multi-step flows (login → use session → logout) without
 * manually threading cookies.
 */
export function createRequestAgent(app) {
    const jar = new CookieJar();
    const agentFetch = async (path, init = {}) => {
        const method = (init.method ?? 'GET').toUpperCase();
        // Build headers: merge caller headers, inject stored cookies.
        const headers = new Headers(init.headers);
        const cookieHeader = jar.toCookieHeader();
        if (cookieHeader.length > 0) {
            headers.set('Cookie', cookieHeader);
        }
        // Auto-inject CSRF header for state-changing verbs unless suppressed.
        if (STATE_CHANGING.has(method) && !init.skipCsrf) {
            const csrfToken = jar.get('csrf_token');
            if (csrfToken !== undefined) {
                headers.set('X-CSRF-Token', csrfToken);
            }
        }
        const req = new Request(`http://test.local${path}`, {
            ...init,
            method,
            headers,
        });
        const res = await app.fetch(req);
        // Ingest any cookies the server set.
        jar.ingest(res);
        return res;
    };
    const csrfHeaders = () => {
        const token = jar.get('csrf_token');
        return token !== undefined ? { 'X-CSRF-Token': token } : {};
    };
    const reset = () => {
        jar.clear();
    };
    return { fetch: agentFetch, csrfHeaders, reset };
}
//# sourceMappingURL=request.js.map