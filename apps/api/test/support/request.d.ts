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
import type { Hono } from 'hono';
export interface RequestAgentInit extends RequestInit {
    /** When true, skip injecting the CSRF header even for state-changing requests. */
    skipCsrf?: boolean;
}
export interface RequestAgent {
    /**
     * Fetch a path against the Hono app.
     * Automatically injects stored cookies and (for POST/PUT/PATCH/DELETE)
     * the X-CSRF-Token header from the csrf_token cookie.
     */
    fetch(path: string, init?: RequestAgentInit): Promise<Response>;
    /**
     * Build an object containing the X-CSRF-Token header lifted from the
     * csrf_token cookie currently in the jar.
     * Returns an empty object when the cookie is absent.
     */
    csrfHeaders(): Record<string, string>;
    /**
     * Reset the cookie jar.
     * Call in beforeEach to isolate successive tests.
     */
    reset(): void;
}
/**
 * Create a request agent wrapping the supplied Hono app.
 *
 * The agent maintains an in-memory cookie jar across successive calls so
 * tests can perform multi-step flows (login → use session → logout) without
 * manually threading cookies.
 */
export declare function createRequestAgent(app: Hono): RequestAgent;
//# sourceMappingURL=request.d.ts.map