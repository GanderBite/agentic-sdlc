/**
 * request.ts — Hono app request helper for integration tests
 *
 * Provides a per-test cookie jar, CSRF double-submit wiring, and convenience
 * methods for authenticating as a seeded user.
 *
 * Usage:
 *
 *   const client = buildClient(app);
 *   await client.loginAs("patient@medbridge.test", "patientpass123!");
 *   const res = await client.csrfPost("/api/logout", {});
 */
import type { Hono } from "hono";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-request extra headers (e.g. Authorization, x-forwarded-for). */
export type ExtraHeaders = Readonly<Record<string, string>>;

/** A lightweight in-memory cookie jar. */
type CookieJar = Map<string, string>;

export type RequestClient = {
  /**
   * Raw fetch against the Hono app. Persists Set-Cookie from the response and
   * sends Cookie header from the jar on subsequent requests.
   */
  fetch(path: string, init?: RequestInit & { extraHeaders?: ExtraHeaders }): Promise<Response>;

  /**
   * POST to `path` with a JSON body, attaching X-CSRF-Token from the
   * `csrf_token` cookie (double-submit pattern).
   *
   * The literal string "X-CSRF-Token" is used as the header name to match the
   * csrf middleware's expected header.
   */
  csrfPost(path: string, body: unknown, extraHeaders?: ExtraHeaders): Promise<Response>;

  /**
   * Authenticate as the given user by POSTing to /api/login.
   * Captures the resulting session, refresh_token, and csrf_token cookies.
   */
  loginAs(email: string, password: string): Promise<Response>;

  /** Clear the cookie jar (use in beforeEach). */
  resetJar(): void;

  /** Read a cookie value from the jar (useful in test assertions). */
  getCookie(name: string): string | undefined;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a raw `Set-Cookie` header value into { name, value }. */
function parseCookiePair(raw: string): { name: string; value: string } | undefined {
  const semi = raw.indexOf(";");
  const segment = semi === -1 ? raw : raw.slice(0, semi);
  const eq = segment.indexOf("=");
  if (eq === -1) {
    return undefined;
  }
  const name = segment.slice(0, eq).trim();
  const value = segment.slice(eq + 1).trim();
  return { name, value };
}

/** Collect all Set-Cookie values from a `Headers` object. */
function collectSetCookies(headers: Headers): string[] {
  const values: string[] = [];
  // `headers.getSetCookie()` is the standard Web API method in Node 18+.
  // Fall back to iterating `headers` if it is not available.
  if (typeof (headers as { getSetCookie?: () => string[] }).getSetCookie === "function") {
    return (headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      values.push(value);
    }
  });
  return values;
}

/** Serialise a cookie jar into a Cookie header string. */
function serialiseJar(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a request client that wraps `app.fetch` with cookie-jar management,
 * CSRF double-submit, and a convenience `loginAs` helper.
 *
 * Each call to `buildClient` produces an independent cookie jar so concurrent
 * tests do not share session state.
 */
export function buildClient(app: Hono): RequestClient {
  const jar: CookieJar = new Map();

  async function doFetch(
    path: string,
    init: RequestInit & { extraHeaders?: ExtraHeaders } = {},
  ): Promise<Response> {
    const { extraHeaders, ...restInit } = init;

    // Build base headers, injecting the cookie jar.
    const headers = new Headers(restInit.headers as HeadersInit | undefined);

    const cookieHeader = serialiseJar(jar);
    if (cookieHeader.length > 0) {
      headers.set("Cookie", cookieHeader);
    }

    // Merge any extra headers (Authorization, x-forwarded-for, etc.).
    if (extraHeaders !== undefined) {
      for (const [k, v] of Object.entries(extraHeaders)) {
        headers.set(k, v);
      }
    }

    const url = `http://test.local${path}`;
    const req = new Request(url, { ...restInit, headers });

    const res = await app.fetch(req);

    // Persist Set-Cookie headers into the jar.
    const setCookies = collectSetCookies(res.headers);
    for (const raw of setCookies) {
      const pair = parseCookiePair(raw);
      if (pair !== undefined) {
        // Deletions are signalled by Max-Age=0 or expires in the past;
        // treat an empty value as a deletion.
        if (pair.value === "" || raw.toLowerCase().includes("max-age=0")) {
          jar.delete(pair.name);
        } else {
          jar.set(pair.name, pair.value);
        }
      }
    }

    return res;
  }

  function csrfPost(
    path: string,
    body: unknown,
    extraHeaders?: ExtraHeaders,
  ): Promise<Response> {
    const csrfToken = jar.get("csrf_token");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (csrfToken !== undefined) {
      // The literal string "X-CSRF-Token" matches csrf middleware's expected header.
      headers["X-CSRF-Token"] = csrfToken;
    }

    const merged: ExtraHeaders = extraHeaders !== undefined
      ? { ...headers, ...extraHeaders }
      : headers;

    return doFetch(path, {
      method: "POST",
      body: JSON.stringify(body),
      extraHeaders: merged,
    });
  }

  async function loginAs(email: string, password: string): Promise<Response> {
    return doFetch("/api/login", {
      method: "POST",
      extraHeaders: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
  }

  return {
    fetch: doFetch,
    csrfPost,
    loginAs,
    resetJar(): void {
      jar.clear();
    },
    getCookie(name: string): string | undefined {
      return jar.get(name);
    },
  };
}
